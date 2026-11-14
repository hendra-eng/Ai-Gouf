'use client';

// Agentic AI: kantor 3D dengan tiga agen (Neo, Atlas, Zeno) -- VERSI TAMPILAN SAJA.
// [DITAHAN SEMENTARA] Fungsi AI belum ikut: tidak ada kontrol suara, rapat, maupun tugas dari server/database.
// Halaman ini hanya menampilkan scene 3D: agen santai di ruangannya, klik ruangan untuk fokus, Esc untuk lepas.
// Saat fungsinya diaktifkan lagi, kembalikan pemakaian rapatKantor.ts & tugasKantor.ts (lihat versi playground-hendra):
// status `rapat` dan `tugas` di bawah akan datang dari event suara + sinkron server (/api/kantor-rapat, /api/kantor-tugas).

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import type { AgentStatus, PenghuniInfo } from './components/OfficeScene';
import { AI_PENGHUNI } from './ai-roster';
import AiFace from './AiFace';

// Three.js butuh browser (WebGL), jadi scene dimuat hanya di sisi client.
const OfficeScene = dynamic(() => import('./components/OfficeScene'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
      Menyiapkan kantor…
    </div>
  ),
});

const STATUS_LABEL: Record<AgentStatus, string> = {
  bekerja: 'Bekerja di meja',
  berjalan: 'Berjalan',
  rapat: 'Di meja rapat',
  santai: 'Santai',
};
const STATUS_DOT: Record<AgentStatus, string> = {
  bekerja: 'bg-emerald-400',
  berjalan: 'bg-amber-300',
  rapat: 'bg-sky-400',
  santai: 'bg-violet-300',
};

// Ikon wajah Neo (robot): kepala biru bulat, visor gelap, mata LED hijau, mulut, telinga, dan antena (sama seperti di scene 3D).
function NeoFaceIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
      <line x1="12" y1="2.6" x2="12" y2="5.2" stroke="#14283F" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="12" cy="2.5" r="1.4" fill="#6EE7B7" />
      <rect x="1.6" y="10.6" width="2.4" height="5" rx="1.1" fill="#14283F" />
      <rect x="20" y="10.6" width="2.4" height="5" rx="1.1" fill="#14283F" />
      <rect x="3.4" y="5.2" width="17.2" height="15" rx="5.2" fill="#4F86C0" />
      <rect x="5.4" y="8.2" width="13.2" height="8.6" rx="3.6" fill="#0A1620" />
      <rect x="8.1" y="10.2" width="2.2" height="3.4" rx="1.1" fill="#6EE7B7" />
      <rect x="13.7" y="10.2" width="2.2" height="3.4" rx="1.1" fill="#6EE7B7" />
      <rect x="10.4" y="15" width="3.2" height="0.9" rx="0.45" fill="#6EE7B7" />
    </svg>
  );
}

const AGENTS: { name: 'Neo' | 'Atlas' | 'Zeno'; color: string; icon?: string; face?: boolean }[] = [
  { name: 'Neo', color: '#1F3B5C', face: true },
  { name: 'Atlas', color: '#6B7C8A', icon: '🦝' },
  { name: 'Zeno', color: '#E8741E', icon: '🦊' },
];

const TUGAS_KOSONG: Record<'Neo' | 'Atlas' | 'Zeno', number | null> = { Neo: null, Atlas: null, Zeno: null };

// AppLayout memberi padding & max-width; div ini membatalkannya (pola sama dengan ZafebAIView)
// supaya kantor mengisi seluruh area di bawah Topbar.
export default function AgenticAIView() {
  const [status, setStatus] = useState<Record<string, AgentStatus>>({});
  const onAgentStatus = useCallback((name: string, s: AgentStatus) => setStatus((p) => ({ ...p, [name]: s })), []);

  // [DITAHAN] Rapat & tugas agen (dari suara Neo + database) dimatikan: kantor selalu dalam keadaan santai.
  // Konstanta di luar komponen supaya referensinya stabil (scene 3D tidak dirender ulang tanpa perlu).
  const rapat = false;
  const tugas = TUGAS_KOSONG;
  // Ruangan yang sedang difokuskan (klik ruangan di scene; Esc / klik area kosong = lepas).
  const [fokus, setFokus] = useState<string | null>(null);
  const [agenDi, setAgenDi] = useState<string[]>([]); // Neo / Atlas / Zeno yang sedang ada di ruangan terfokus
  const [penghuni, setPenghuni] = useState<Record<string, PenghuniInfo>>({}); // AI penghuni yang sedang ada di ruangan terfokus (termasuk tamu)

  return (
    <div className="w-full h-[calc(100vh-4rem)] overflow-hidden relative isolate bg-[radial-gradient(ellipse_at_50%_45%,#12332A_0%,#0A1A14_45%,#020605_100%)]">
      <OfficeScene onAgentStatus={onAgentStatus} rapat={rapat} tugas={tugas} onFokusRuang={(n) => { setFokus(n); if (!n) { setAgenDi([]); setPenghuni({}); } }} onAgenDiRuang={setAgenDi} onPenghuni={setPenghuni} />

      {fokus && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-black/50 py-1.5 pl-4 pr-1.5 text-sm text-white backdrop-blur">
            <span className="font-semibold">{fokus}</span>
            <span className="hidden text-white/60 sm:inline">Esc atau klik area kosong untuk kembali</span>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('agentic:lepas-fokus'))}
              className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* Karyawan (AI) di ruangan yang sedang difokuskan: hanya muncul setelah ruangan diklik. Baris bisa digeser kiri-kanan. */}
      {fokus && (
      <div
        className="absolute inset-x-0 top-0 flex gap-2 overflow-x-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(e) => { e.currentTarget.scrollLeft += e.deltaY + e.deltaX; }}
      >
        {AGENTS.filter((a) => agenDi.includes(a.name)).map((a) => {
          const st = status[a.name] ?? 'santai';
          return (
            <div
              key={a.name}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-black/40 py-1.5 pl-2 pr-3.5 text-sm text-white backdrop-blur"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold" style={{ background: a.color }}>
                {a.face ? <NeoFaceIcon /> : (a.icon ?? a.name[0])}
              </span>
              <span className="font-semibold">{a.name}</span>
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[st]}`} />
              <span className="text-white/70">{STATUS_LABEL[st]}</span>
            </div>
          );
        })}
        {/* AI penghuni yang sedang ada di ruangan ini (penghuni maupun tamu yang berkunjung), dengan status sebenarnya */}
        {AI_PENGHUNI.filter((a) => penghuni[a.name]).map((a) => {
          const { status: st, teks } = penghuni[a.name]; // teks & status dari pet-Direktur.ts
          return (
            <div
              key={a.name}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-black/40 py-1.5 pl-2 pr-3.5 text-sm text-white backdrop-blur"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: a.accent }}>
                <AiFace ai={a} />
              </span>
              <span className="font-semibold">{a.name}</span>
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[st]}`} />
              <span className="text-white/70">{teks}</span>
            </div>
          );
        })}
        {agenDi.length === 0 && Object.keys(penghuni).length === 0 && (
          <div className="shrink-0 whitespace-nowrap rounded-full bg-black/40 px-3.5 py-1.5 text-sm text-white/70 backdrop-blur">
            Tidak ada karyawan di ruangan ini
          </div>
        )}
      </div>
      )}
    </div>
  );
}