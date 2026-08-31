import React from 'react';

type BadgeVariant = 'positive' | 'negative' | 'warning' | 'info' | 'ai' | 'neutral';

interface StatusBadgeProps {
  label: string;
  variant?: BadgeVariant;
  dot?: boolean;
  // Dari Kodingan 2 — opsional, supaya halaman baru yang belum pakai "variant"
  // tetap bisa styling manual lewat className
  className?: string;
  size?: 'sm' | 'md';
}

const variantMap: Record<BadgeVariant, string> = {
  positive: 'badge-positive',
  negative: 'badge-negative',
  warning: 'badge-warning',
  info: 'badge-info',
  ai: 'badge-ai',
  neutral: 'badge-neutral',
};

const dotColorMap: Record<BadgeVariant, string> = {
  positive: 'bg-positive',
  negative: 'bg-negative',
  warning: 'bg-warning',
  info: 'bg-info',
  ai: 'bg-ai',
  neutral: 'bg-muted-foreground',
};

// Dari Kodingan 2 — kelas ukuran, dipakai kalau prop "size" diisi
const sizeMap: Record<'sm' | 'md', string> = {
  sm: 'text-2xs px-1.5 py-0.5',
  md: 'text-xs px-2 py-1',
};

export default function StatusBadge({
  label,
  variant = 'neutral',
  dot = false,
  className = '',
  size,
}: StatusBadgeProps) {
  // Kalau "size" diisi (gaya kodingan 2), pakai base class generik + ukuran + className manual
  if (size) {
    return (
      <span
        className={`inline-flex items-center rounded-full font-600 whitespace-nowrap ${sizeMap[size]} ${className}`}
      >
        {label}
      </span>
    );
  }

  // Default: gaya kodingan 1, berbasis variant
  return (
    <span className={`${variantMap[variant]} ${className}`}>
      {dot && <span className={`status-dot ${dotColorMap[variant]}`} />}
      {label}
    </span>
  );
}