'use client';
import React from 'react';

// Logo asli zafeb (simbol + tulisan "zafeb") dari /assets/images/zafeb-logo.png.
// Gambar TIDAK diubah sama sekali (bentuk, huruf, dan warnanya asli); hanya diberi tile putih
// supaya tulisan hijau tuanya tetap terbaca di atas sidebar/topbar yang gelap.
export default function BrandLogo({ height = 52, className = '' }: { height?: number; className?: string }) {
  return (
    <div
      className={`flex-shrink-0 flex items-center justify-center rounded-xl bg-white ring-1 ring-white/30 shadow-lg shadow-black/30 ${className}`}
      style={{ height, width: height }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/images/zafeb-logo.png"
        alt="zafeb"
        draggable={false}
        className="block h-full w-full select-none object-contain p-0.5"
      />
    </div>
  );
}