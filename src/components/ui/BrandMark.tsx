'use client';
import React, { useState } from 'react';

// Logo zafeb untuk Sidebar & Topbar. /icon.png sudah berupa lingkaran putih berisi simbol hijau,
// jadi dibingkai bulat (bukan kotak) dengan cincin tipis + bayangan lembut.
// Pakai <img> biasa (bukan next/image) supaya tidak bergantung pada image optimizer: logo harus
// selalu tampil. Kalau file utama gagal dimuat, dipakai logo cadangan.
const SUMBER = ['/icon.png', '/assets/images/zafeb-logo.png'];

export default function BrandMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  const [i, setI] = useState(0);
  return (
    <div
      className={`flex-shrink-0 rounded-full bg-white ring-1 ring-white/30 shadow-lg shadow-black/30 ${className}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={SUMBER[i]}
        alt="zafeb"
        width={size}
        height={size}
        draggable={false}
        onError={() => setI((n) => Math.min(n + 1, SUMBER.length - 1))}
        className="block w-full h-full rounded-full object-contain select-none"
      />
    </div>
  );
}
