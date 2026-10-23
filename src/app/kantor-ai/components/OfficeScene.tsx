'use client';

// Kantor 3D low-poly (kamera isometrik) — mode desain. Agen: Neo (robot), Hendra & Virgan (manusia).
// Isi: ruangan, meja kerja, meja rapat bundar, sofa, tanaman, dan satu agen "Neo"
// yang berpindah antara mejanya dan meja rapat. Semua dari kotak/silinder (tanpa file model).
// Backend belum terhubung: gerakan Neo masih jadwal simulasi (ROUTE di bawah).
// Nanti ROUTE diganti event dari backend (mis. SSE) -> tujuan & status Neo.

import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

export type AgentStatus = 'bekerja' | 'berjalan' | 'rapat';
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

function Box({ pos, size, color, rot, cast = true }: { pos: V3; size: V3; color: string; rot?: V3; cast?: boolean }) {
  return (
    <mesh position={pos} rotation={rot} castShadow={cast} receiveShadow>
      <boxGeometry args={size} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

function Cyl({ pos, r, h, color, seg = 24 }: { pos: V3; r: number; h: number; color: string; seg?: number }) {
  return (
    <mesh position={pos} castShadow receiveShadow>
      <cylinderGeometry args={[r, r, h, seg]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

// Dinding tinggi: memudar saat kamera berada di sisi luarnya, supaya isi ruangan tetap terlihat saat diputar.
function Wall({ pos, size, axis }: { pos: V3; size: V3; axis: 'x' | 'z' }) {
  const mat = useRef<THREE.MeshLambertMaterial>(null);
  useFrame(({ camera }, dt) => {
    const m = mat.current;
    if (!m) return;
    const outside = axis === 'z' ? camera.position.z < pos[2] : camera.position.x < pos[0];
    m.opacity += ((outside ? 0.1 : 1) - m.opacity) * Math.min(1, dt * 8);
  });
  return (
    <mesh position={pos} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshLambertMaterial ref={mat} color={C.wall} transparent />
    </mesh>
  );
}

function Room() {
  return (
    <group>
      <Box pos={[0, -0.1, 0]} size={[16, 0.2, 11]} color={C.floor} cast={false} />
      {/* dinding belakang & kiri */}
      <Wall pos={[0, 0.8, -5.6]} size={[16.4, 1.6, 0.2]} axis="z" />
      <Wall pos={[-8.1, 0.8, 0]} size={[0.2, 1.6, 11]} axis="x" />
      <Box pos={[0, 1.62, -5.6]} size={[16.4, 0.04, 0.24]} color={C.wallEdge} cast={false} />
      <Box pos={[-8.1, 1.62, 0]} size={[0.24, 0.04, 11]} color={C.wallEdge} cast={false} />
      {/* bingkai depan & kanan (rendah) */}
      <Box pos={[0, 0.15, 5.6]} size={[16.4, 0.3, 0.2]} color={C.wall} />
      <Box pos={[8.1, 0.15, 0]} size={[0.2, 0.3, 11]} color={C.wall} />
      {/* hiasan dinding */}
      <Box pos={[-3.2, 1.05, -5.47]} size={[1.1, 0.6, 0.05]} color="#2F7D5B" cast={false} />
      <Box pos={[-3.2, 1.05, -5.44]} size={[0.95, 0.45, 0.02]} color="#A7F3D0" cast={false} />
      <Box pos={[3.4, 1.05, -5.47]} size={[1.4, 0.7, 0.05]} color="#E8F0F5" cast={false} />
      <Box pos={[3.4, 1.05, -5.44]} size={[0.05, 0.7, 0.03]} color={C.wall} cast={false} />
      <Box pos={[-7.97, 1.05, -2]} size={[0.05, 0.6, 1.0]} color="#E8F0F5" cast={false} />
      {/* karpet area rapat */}
      <Box pos={[4.6, 0.01, 1.8]} size={[5.6, 0.02, 4.8]} color={C.rug} cast={false} />
    </group>
  );
}

function Desk({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <Box pos={[0, 0.78, 0]} size={[1.7, 0.08, 0.85]} color={C.wood} />
      <Box pos={[-0.78, 0.37, 0]} size={[0.08, 0.74, 0.78]} color={C.woodDark} />
      <Box pos={[0.78, 0.37, 0]} size={[0.08, 0.74, 0.78]} color={C.woodDark} />
      <Box pos={[0, 0.93, -0.18]} size={[0.1, 0.22, 0.1]} color="#2B3340" />
      <Box pos={[0, 1.22, -0.2]} size={[0.66, 0.42, 0.05]} color="#2B3340" />
      <mesh position={[0, 1.22, -0.17]}>
        <boxGeometry args={[0.58, 0.34, 0.01]} />
        <meshStandardMaterial color={C.screen} emissive={C.glow} emissiveIntensity={0.35} />
      </mesh>
      <Box pos={[0, 0.83, 0.17]} size={[0.5, 0.02, 0.18]} color="#D9DEE3" cast={false} />
    </group>
  );
}

// Kursi menghadap -z (ke arah meja). rotY memutar kursi.
function Chair({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.32, 0]} size={[0.55, 0.08, 0.55]} color={C.chair} />
      <Box pos={[0, 0.66, 0.25]} size={[0.55, 0.6, 0.08]} color={C.chair} />
      <Box pos={[0, 0.16, 0]} size={[0.08, 0.3, 0.08]} color="#2B3340" />
      <Box pos={[0, 0.03, 0]} size={[0.5, 0.05, 0.5]} color="#2B3340" cast={false} />
    </group>
  );
}

const MEETING: [number, number] = [4.6, 1.8];

function MeetingTable() {
  const seats = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  return (
    <group position={[MEETING[0], 0, MEETING[1]]}>
      <Cyl pos={[0, 0.75, 0]} r={1.3} h={0.08} color={C.wood} seg={32} />
      <Cyl pos={[0, 0.37, 0]} r={0.12} h={0.74} color={C.woodDark} />
      {seats.map((a) => (
        <Chair key={a} pos={[Math.sin(a) * 1.9, 0, Math.cos(a) * 1.9]} rotY={a} />
      ))}
    </group>
  );
}

function Sofa({ pos, rotY, color }: { pos: V3; rotY: number; color: string }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <Box pos={[0, 0.25, 0]} size={[2.1, 0.5, 0.9]} color={color} />
      <Box pos={[0, 0.65, 0.35]} size={[2.1, 0.5, 0.22]} color={color} />
      <Box pos={[-1.0, 0.45, 0]} size={[0.2, 0.7, 0.9]} color={color} />
      <Box pos={[1.0, 0.45, 0]} size={[0.2, 0.7, 0.9]} color={color} />
    </group>
  );
}

function Plant({ pos, scale = 1 }: { pos: V3; scale?: number }) {
  return (
    <group position={pos} scale={scale}>
      <Cyl pos={[0, 0.2, 0]} r={0.22} h={0.4} color={C.pot} />
      <mesh position={[0, 0.75, 0]} castShadow>
        <icosahedronGeometry args={[0.38, 0]} />
        <meshLambertMaterial color={C.leaf} flatShading />
      </mesh>
      <mesh position={[0.12, 1.1, 0.05]} castShadow>
        <icosahedronGeometry args={[0.24, 0]} />
        <meshLambertMaterial color="#58B879" flatShading />
      </mesh>
    </group>
  );
}

function Bookshelf({ pos }: { pos: V3 }) {
  const books = ['#E0713F', '#4C5FA8', '#2F7D5B', '#E8C95A', '#B05A7A'];
  return (
    <group position={pos}>
      <Box pos={[0, 0.9, 0]} size={[1.6, 1.8, 0.4]} color={C.woodDark} />
      {[0.3, 0.8, 1.3].map((y, r) =>
        books.map((c, i) => (
          <Box key={`${r}-${i}`} pos={[-0.55 + i * 0.27, y + 0.18, 0.1]} size={[0.14, 0.3, 0.22]} color={c} cast={false} />
        ))
      )}
    </group>
  );
}

const DESKS: [number, number][] = [
  [-5, -3.6],
  [-1.5, -3.6],
  [2, -3.6],
  [-5, -0.2],
  [-1.5, -0.2],
];
const NEO_DESK: [number, number] = [-1.5, -3.6];

function Furniture() {
  return (
    <group>
      {DESKS.map(([x, z]) => (
        <React.Fragment key={`${x}-${z}`}>
          <Desk pos={[x, 0, z]} />
          <Chair pos={[x, 0, z + 0.85]} />
        </React.Fragment>
      ))}
      <MeetingTable />
      <Sofa pos={[-7.2, 0, 3]} rotY={-Math.PI / 2} color={C.sofaBlue} />
      <Sofa pos={[-6.2, 0, 4.9]} rotY={Math.PI} color={C.sofaOrange} />
      <Box pos={[-5.0, 0.2, 3.0]} size={[1, 0.4, 0.7]} color={C.woodDark} />
      <Bookshelf pos={[6.2, 0, -5.3]} />
      <Plant pos={[-7.4, 0, -5.0]} scale={1.2} />
      <Plant pos={[7.4, 0, -4.6]} />
      <Plant pos={[7.4, 0, 4.6]} />
      <Plant pos={[0.8, 0, 4.8]} scale={0.9} />
    </group>
  );
}

// ---- Agen (Neo = robot, Hendra & Virgan = manusia) ---------------------

type Wp = { p: [number, number]; face?: number; sit?: boolean; wait?: number; status: AgentStatus };
type Look = {
  kind: 'robot' | 'human';
  torso: string;
  legs: string;
  arms: string;
  head: string;
  hair?: string;
};

// Kursi meja rapat ada di sudut 45°, 135°, 225°, 315°. Menghadap meja = sudut + 180°.
const seatAt = (a: number): [number, number] => [MEETING[0] + Math.sin(a) * 1.9, MEETING[1] + Math.cos(a) * 1.9];
const deskSeat = (d: [number, number]): [number, number] => [d[0], d[1] + 0.85];

const LOOK_NEO: Look = { kind: 'robot', torso: C.robot, legs: C.robot, arms: C.robotLight, head: C.robotLight };
const LOOK_HENDRA: Look = { kind: 'human', torso: '#DDE6EC', legs: '#2B3340', arms: '#DDE6EC', head: '#C68E65', hair: '#1B1B1B' };
const LOOK_VIRGAN: Look = { kind: 'human', torso: '#D9A441', legs: '#3E4A66', arms: '#D9A441', head: '#E0AC85', hair: '#3B2A1E' };

// Jadwal simulasi per agen. Nanti diganti event dari backend.
const NEO_SEAT = deskSeat(NEO_DESK);
const NEO_MEET = seatAt((5 * Math.PI) / 4);
const NEO_ROUTE: Wp[] = [
  { p: NEO_SEAT, face: Math.PI, sit: true, wait: 9, status: 'bekerja' },
  { p: [NEO_SEAT[0], -1.9], status: 'berjalan' },
  { p: [2.6, -1.9], status: 'berjalan' },
  { p: [2.7, 0.1], status: 'berjalan' },
  { p: NEO_MEET, face: Math.PI / 4, sit: true, wait: 7, status: 'rapat' },
  { p: [2.7, 0.1], status: 'berjalan' },
  { p: [2.6, -1.9], status: 'berjalan' },
  { p: [NEO_SEAT[0], -1.9], status: 'berjalan' },
];

const HENDRA_DESK: [number, number] = [-5, -3.6];
const HENDRA_SEAT = deskSeat(HENDRA_DESK);
const HENDRA_MEET = seatAt((3 * Math.PI) / 4);
const HENDRA_ROUTE: Wp[] = [
  { p: HENDRA_SEAT, face: Math.PI, sit: true, wait: 14, status: 'bekerja' },
  { p: [HENDRA_SEAT[0], -1.5], status: 'berjalan' },
  { p: [6.3, -1.5], status: 'berjalan' },
  { p: [6.3, 0.0], status: 'berjalan' },
  { p: HENDRA_MEET, face: (7 * Math.PI) / 4, sit: true, wait: 8, status: 'rapat' },
  { p: [6.3, 0.0], status: 'berjalan' },
  { p: [6.3, -1.5], status: 'berjalan' },
  { p: [HENDRA_SEAT[0], -1.5], status: 'berjalan' },
];

const VIRGAN_DESK: [number, number] = [2, -3.6];
const VIRGAN_SEAT = deskSeat(VIRGAN_DESK);
const VIRGAN_MEET = seatAt((7 * Math.PI) / 4);
const VIRGAN_ROUTE: Wp[] = [
  { p: VIRGAN_SEAT, face: Math.PI, sit: true, wait: 5, status: 'bekerja' },
  { p: [VIRGAN_SEAT[0], -2.0], status: 'berjalan' },
  { p: [2.1, 3.14], status: 'berjalan' },
  { p: VIRGAN_MEET, face: (3 * Math.PI) / 4, sit: true, wait: 10, status: 'rapat' },
  { p: [2.1, 3.14], status: 'berjalan' },
  { p: [VIRGAN_SEAT[0], -2.0], status: 'berjalan' },
];

const SPEED = 1.7;
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const dotColor = (s: AgentStatus) => (s === 'bekerja' ? '#4ADE80' : s === 'rapat' ? '#38BDF8' : '#FCD34D');

// Label nama di atas kepala (sprite dari canvas, selalu menghadap kamera & tidak tertutup benda lain).
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

function Agent({
  name,
  look,
  route,
  onStatus,
  still,
}: {
  name: string;
  look: Look;
  route: Wp[];
  onStatus?: (name: string, s: AgentStatus) => void;
  still: boolean;
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
  const st = useRef({ idx: 0, waiting: true, timer: route[0].wait ?? 0, sit: 1, walk: 0, lastStatus: '' as string });
  const [label, setLabel] = React.useState<AgentStatus>(route[0].status);
  const robot = look.kind === 'robot';

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const s = st.current;
    const g = root.current;
    if (!g) return;

    const wp = route[s.idx];
    let moving = false;

    if (!still) {
      if (s.waiting) {
        s.timer -= dt;
        if (s.timer <= 0) {
          s.idx = (s.idx + 1) % route.length;
          s.waiting = false;
        }
      } else {
        const dx = wp.p[0] - g.position.x;
        const dz = wp.p[1] - g.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.05) {
          if (wp.wait) {
            s.waiting = true;
            s.timer = wp.wait;
          } else {
            s.idx = (s.idx + 1) % route.length;
          }
        } else {
          moving = true;
          const step = Math.min(SPEED * dt, dist);
          g.position.x += (dx / dist) * step;
          g.position.z += (dz / dist) * step;
          const target = Math.atan2(dx, dz);
          g.rotation.y += angleDiff(g.rotation.y, target) * Math.min(1, dt * 10);
        }
      }
    }

    const cur = route[s.idx];
    if (!moving && cur.face !== undefined) {
      g.rotation.y += angleDiff(g.rotation.y, cur.face) * Math.min(1, dt * 6);
    }

    const sitTarget = !moving && s.waiting && cur.sit ? 1 : 0;
    s.sit += (sitTarget - s.sit) * Math.min(1, dt * 6);
    s.walk += ((moving ? 1 : 0) - s.walk) * Math.min(1, dt * 8);

    const sit = s.sit;
    const walk = s.walk;
    const swing = Math.sin(t * 9) * 0.65 * walk;

    if (body.current) body.current.position.y = -0.07 * sit + Math.abs(Math.sin(t * 9)) * 0.04 * walk;
    if (legL.current) legL.current.rotation.x = swing * (1 - sit) - (Math.PI / 2) * sit;
    if (legR.current) legR.current.rotation.x = -swing * (1 - sit) - (Math.PI / 2) * sit;
    if (shinL.current) shinL.current.rotation.x = (Math.PI / 2) * sit;
    if (shinR.current) shinR.current.rotation.x = (Math.PI / 2) * sit;

    const typing = sit > 0.9 && cur.status === 'bekerja';
    const armBase = sit * (cur.status === 'bekerja' ? -1.15 : -0.5);
    if (armL.current) armL.current.rotation.x = -swing * (1 - sit) + armBase + (typing ? Math.sin(t * 15) * 0.1 : 0);
    if (armR.current) armR.current.rotation.x = swing * (1 - sit) + armBase + (typing ? Math.sin(t * 15 + 2) * 0.1 : 0);
    if (head.current) {
      head.current.rotation.y = cur.status === 'rapat' && sit > 0.9 ? Math.sin(t * 0.8) * 0.25 : 0;
      head.current.rotation.x = typing ? 0.12 : 0;
    }

    if (s.lastStatus !== cur.status) {
      s.lastStatus = cur.status;
      setLabel(cur.status);
      onStatus?.(name, cur.status);
    }
  });

  const dot = dotColor(label);

  return (
    <group ref={root} position={[route[0].p[0], 0, route[0].p[1]]} rotation={[0, Math.PI, 0]}>
      <group ref={body}>
        {/* kaki */}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? legL : legR} position={[side * 0.12, 0.5, 0]}>
            <Box pos={[0, -0.125, 0]} size={[0.14, 0.25, 0.14]} color={look.legs} />
            <group ref={side < 0 ? shinL : shinR} position={[0, -0.25, 0]}>
              <Box pos={[0, -0.125, 0]} size={[0.14, 0.25, 0.14]} color={look.legs} />
              <Box pos={[0, -0.26, 0.04]} size={[0.16, 0.06, 0.24]} color={robot ? '#14283F' : '#1E1E24'} />
            </group>
          </group>
        ))}
        {/* badan */}
        <Box pos={[0, 0.78, 0]} size={[0.44, 0.5, 0.27]} color={look.torso} />
        {robot ? (
          <Box pos={[0, 0.8, 0.14]} size={[0.2, 0.2, 0.02]} color={C.glow} cast={false} />
        ) : (
          <Box pos={[0, 0.5, 0]} size={[0.46, 0.06, 0.29]} color="#23252B" cast={false} />
        )}
        {/* lengan */}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? armL : armR} position={[side * 0.3, 0.98, 0]}>
            <Box pos={[0, -0.17, 0]} size={[0.1, 0.34, 0.1]} color={look.arms} />
            {!robot && <Box pos={[0, -0.39, 0]} size={[0.09, 0.1, 0.09]} color={look.head} />}
            {robot && <Box pos={[0, -0.37, 0]} size={[0.1, 0.06, 0.1]} color={look.arms} />}
          </group>
        ))}
        {/* kepala */}
        <group ref={head} position={[0, 1.2, 0]}>
          {robot ? (
            <>
              <Box pos={[0, 0, 0]} size={[0.5, 0.4, 0.4]} color={look.head} />
              <Box pos={[0, 0, 0.205]} size={[0.4, 0.26, 0.02]} color="#0A1620" cast={false} />
              {[-1, 1].map((side) => (
                <mesh key={side} position={[side * 0.09, 0.01, 0.222]}>
                  <boxGeometry args={[0.07, 0.1, 0.02]} />
                  <meshStandardMaterial color={C.glow} emissive={C.glow} emissiveIntensity={1.2} />
                </mesh>
              ))}
              <Box pos={[0, 0.3, 0]} size={[0.03, 0.2, 0.03]} color="#14283F" />
              <mesh position={[0, 0.43, 0]}>
                <sphereGeometry args={[0.055, 12, 12]} />
                <meshStandardMaterial color={dot} emissive={dot} emissiveIntensity={1} />
              </mesh>
            </>
          ) : (
            <>
              <Box pos={[0, 0, 0]} size={[0.38, 0.38, 0.38]} color={look.head} />
              <Box pos={[0, 0.2, -0.01]} size={[0.42, 0.14, 0.42]} color={look.hair ?? '#222'} />
              <Box pos={[0, 0.02, -0.17]} size={[0.42, 0.3, 0.1]} color={look.hair ?? '#222'} />
              {[-1, 1].map((side) => (
                <Box key={side} pos={[side * 0.09, 0.03, 0.195]} size={[0.05, 0.06, 0.02]} color="#1B1B1B" cast={false} />
              ))}
              <Box pos={[0, -0.09, 0.195]} size={[0.1, 0.02, 0.02]} color="#8A4B3C" cast={false} />
              <Box pos={[0, -0.26, 0]} size={[0.14, 0.14, 0.14]} color={look.head} />
            </>
          )}
        </group>
      </group>
      <NameTag name={name} dot={dot} />
    </group>
  );
}

// ---- Kamera & scene ----------------------------------------------------

function FitCamera() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    // Ruangan (16 x 11) terproyeksi isometrik ~ 20 unit lebar, ~ 14 unit tinggi.
    (camera as THREE.OrthographicCamera).zoom = Math.max(18, Math.min(size.width / 21, size.height / 15));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export default function OfficeScene({ onAgentStatus }: { onAgentStatus?: (name: string, s: AgentStatus) => void }) {
  const still = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  return (
    <Canvas
      orthographic
      shadows
      dpr={[1, 2]}
      camera={{ position: [16, 15, 16], zoom: 45, near: -60, far: 120 }}
      className="!absolute inset-0"
    >
      <color attach="background" args={['#0A1A14']} />
      <FitCamera />
      <ambientLight intensity={0.85} />
      <hemisphereLight args={['#FFFFFF', '#9DB8A8', 0.35]} />
      <directionalLight
        position={[8, 14, 6]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={0.5}
        shadow-camera-far={60}
      />
      <Room />
      <Furniture />
      <Agent name="Neo" look={LOOK_NEO} route={NEO_ROUTE} onStatus={onAgentStatus} still={still} />
      <Agent name="Hendra" look={LOOK_HENDRA} route={HENDRA_ROUTE} onStatus={onAgentStatus} still={still} />
      <Agent name="Virgan" look={LOOK_VIRGAN} route={VIRGAN_ROUTE} onStatus={onAgentStatus} still={still} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.9}
        minZoom={20}
        maxZoom={110}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2 - 0.05}
      />
    </Canvas>
  );
}