'use client';

// Ilustrasi kecil dekoratif di pojok kanan bawah kartu report (tab Reports) --
// bentuknya sama dengan CardArt di katalog Reports (app/reports/components/ReportsCatalog.tsx),
// monokrom abu + hitam, hanya ukurannya diperkecil agar pas di kartu Asset.

import React from 'react';

export type FaReportArtKind = 'bars' | 'line' | 'area' | 'rows' | 'doc' | 'table' | 'adjust';

const C = '#404040';  // aksen
const S = '#D4D4D4';  // abu lembut

export default function FaReportArt({ art, width = 76, height = 61 }: { art: FaReportArtKind; width?: number; height?: number }) {
  const common = { width, height, viewBox: '0 0 104 84', 'aria-hidden': true } as const;
  switch (art) {
    case 'bars':
      return (
        <svg {...common}>
          <rect x="8" y="50" width="22" height="30" rx="4" fill={S} />
          <rect x="38" y="34" width="22" height="46" rx="4" fill={S} opacity="0.85" />
          <rect x="68" y="8" width="22" height="72" rx="4" fill={C} opacity="0.55" />
        </svg>
      );
    case 'line':
      return (
        <svg {...common}>
          <rect x="18" y="56" width="16" height="24" rx="3" fill={S} />
          <rect x="44" y="48" width="16" height="32" rx="3" fill={S} />
          <rect x="70" y="34" width="16" height="46" rx="3" fill={S} />
          <path d="M6 50 C 24 30, 40 44, 58 30 S 88 10, 98 10" fill="none" stroke={C} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
        </svg>
      );
    case 'area':
      return (
        <svg {...common}>
          <path d="M4 80 L4 62 C 24 58, 36 46, 54 48 S 84 20, 100 12 L100 80 Z" fill={S} opacity="0.6" />
          <path d="M4 62 C 24 58, 36 46, 54 48 S 84 20, 100 12" fill="none" stroke={C} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
          <rect x="28" y="64" width="14" height="16" rx="3" fill={S} />
          <rect x="54" y="56" width="14" height="24" rx="3" fill={S} />
        </svg>
      );
    case 'rows':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="96" height="78" rx="8" fill={S} opacity="0.35" />
          {[16, 30, 44, 58].map(y => (
            <g key={y}>
              <rect x="14" y={y} width="16" height="7" rx="3.5" fill={S} />
              <rect x="38" y={y} width="52" height="7" rx="3.5" fill={S} />
            </g>
          ))}
        </svg>
      );
    case 'doc':
      return (
        <svg {...common}>
          <rect x="10" y="4" width="88" height="78" rx="8" fill={S} opacity="0.4" />
          <rect x="24" y="18" width="46" height="6" rx="3" fill={C} opacity="0.55" />
          <rect x="24" y="32" width="38" height="6" rx="3" fill={C} opacity="0.45" />
          <rect x="24" y="46" width="60" height="6" rx="3" fill={C} opacity="0.55" />
          <rect x="24" y="60" width="44" height="6" rx="3" fill={C} opacity="0.45" />
        </svg>
      );
    case 'table':
      return (
        <svg {...common}>
          {[8, 24, 40, 56].map((y, r) => (
            <g key={y}>
              <rect x="8" y={y} width="22" height="9" rx="3" fill={r % 2 ? S : C} opacity={r % 2 ? 0.6 : 0.3} />
              <rect x="36" y={y} width="28" height="9" rx="3" fill={r % 2 ? S : C} opacity={r % 2 ? 0.6 : 0.3} />
              <rect x="70" y={y} width="28" height="9" rx="3" fill={r % 2 ? S : C} opacity={r % 2 ? 0.6 : 0.3} />
            </g>
          ))}
        </svg>
      );
    case 'adjust':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="96" height="78" rx="8" fill={S} opacity="0.35" />
          {[16, 36, 56].map(y => (
            <g key={y}>
              <rect x="14" y={y} width="36" height="7" rx="3.5" fill={S} />
              <rect x="58" y={y} width="16" height="7" rx="3.5" fill={C} opacity="0.5" />
              <path d={`M86 ${y + 3.5} h8`} stroke={C} strokeWidth="2" strokeLinecap="round" />
            </g>
          ))}
        </svg>
      );
  }
}