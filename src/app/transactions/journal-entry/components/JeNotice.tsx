'use client';

import React from 'react';

// Banner error bersama halaman Journal Entry -- gaya sama dengan Sales
// (merah lembut, tombol "Retry" bergaris bawah).
export function JeErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const pesan = /not found/i.test(message)
    ? `${message} (endpoint server tidak ditemukan)`
    : message;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between"
    >
      <span>{pesan}</span>
      {onRetry && (
        <button onClick={onRetry} className="underline font-medium">
          Retry
        </button>
      )}
    </div>
  );
}
