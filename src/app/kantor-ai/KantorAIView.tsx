'use client';

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { Mic } from 'lucide-react';
import type { AgentStatus } from './components/OfficeScene';

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
};
const STATUS_DOT: Record<AgentStatus, string> = {
  bekerja: 'bg-emerald-400',
  berjalan: 'bg-amber-300',
  rapat: 'bg-sky-400',
};

const AGENTS = [
  { name: 'Neo', color: '#2E5A86' },
  { name: 'Hendra', color: '#6B7C8A' },
  { name: 'Virgan', color: '#B98A2E' },
];

// AppLayout memberi padding & max-width; div ini membatalkannya (pola sama dengan AgentAIView)
// supaya kantor mengisi seluruh area di bawah Topbar.
export default function KantorAIView() {
  const [status, setStatus] = useState<Record<string, AgentStatus>>({});
  const onAgentStatus = useCallback((name: string, s: AgentStatus) => setStatus((p) => ({ ...p, [name]: s })), []);

  return (
    <div className="-mx-4 lg:-mx-6 xl:-mx-8 2xl:-mx-10 -my-6 h-[calc(100vh-4rem)] overflow-hidden relative isolate bg-[#0A1A14] shadow-[0_0_0_100vmax_#0A1A14]">
      <OfficeScene onAgentStatus={onAgentStatus} />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          {AGENTS.map((a) => {
            const st = status[a.name] ?? 'bekerja';
            return (
              <div key={a.name} className="flex items-center gap-2 rounded-full bg-black/40 py-1.5 pl-2 pr-3.5 text-sm text-white backdrop-blur">
                <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold" style={{ background: a.color }}>
                  {a.name[0]}
                </span>
                <span className="font-semibold">{a.name}</span>
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[st]}`} />
                <span className="text-white/70">{STATUS_LABEL[st]}</span>
              </div>
            );
          })}
        </div>
        <div className="rounded-full bg-black/40 px-3.5 py-1.5 text-xs text-white/70 backdrop-blur">
          Mode desain · belum terhubung ke backend
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4">
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/55 py-2 pl-2 pr-5 text-sm text-white backdrop-blur">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/60">
            <Mic size={16} />
          </span>
          <span>
            <span className="block text-xs text-white/50">Agen utama</span>
            <span className="block leading-tight">Neo menunggu perintah</span>
          </span>
        </div>
      </div>
    </div>
  );
}