'use client';

import AgentAIChat from './AgentAIChat';

// [MIGRASI] AppLayout.tsx membungkus {children} dengan container yang
// punya max-width + padding (py-6, px-4..px-10) -- pas untuk halaman
// dashboard biasa (kartu KPI, tabel, dst), tapi chat UI ini didesain
// full-height, edge-to-edge (sidebar riwayat + area chat + artifact
// panel berdampingan, masing-masing scroll sendiri).
//
// Div di bawah ini "membatalkan" padding & max-width dari AppLayout
// pakai margin negatif yang sama persis dengan kelas padding di
// AppLayout.tsx (-mx-4 lg:-mx-6 xl:-mx-8 2xl:-mx-10 -my-6), lalu
// tinggi dipatok penuh dikurangi tinggi Topbar (64px / 4rem) supaya
// area chat persis mengisi sisa layar tanpa scroll ganda.
export default function AgentAIView() {
  return (
    <div className="-mx-4 lg:-mx-6 xl:-mx-8 2xl:-mx-10 -my-6 h-[calc(100vh-4rem)] overflow-hidden">
      <AgentAIChat />
    </div>
  );
}
