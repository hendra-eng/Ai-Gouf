'use client';
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, subtitle, onClose, children, footer, wide }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`fin-card w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-border">
          <div>
            <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
            {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted" aria-label="Close"><X size={16} className="text-muted-foreground" /></button>
        </div>
        <div className="p-5 overflow-y-auto scrollbar-thin">{children}</div>
        {footer && <div className="p-4 border-t border-border flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-muted-foreground mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-muted-foreground mt-1">{hint}</span>}
    </label>
  );
}

/** Input angka Rupiah: format ribuan saat tidak fokus, nilai dikomit saat blur/Enter. */
export function MoneyInput({ value, onCommit, className = '', disabled, placeholder }: {
  value: number; onCommit: (n: number) => void; className?: string; disabled?: boolean; placeholder?: string;
}) {
  const fmt = (n: number) => (n ? Math.round(n).toLocaleString('id-ID') : '');
  const [text, setText] = useState(fmt(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(fmt(value)); }, [value, focus]);

  const commit = () => {
    const n = Number(text.replace(/[^\d]/g, '')) || 0;
    if (n !== value) onCommit(n);
    setText(fmt(n));
  };

  return (
    <input
      inputMode="numeric"
      value={text}
      disabled={disabled}
      placeholder={placeholder ?? '0'}
      onFocus={() => setFocus(true)}
      onChange={e => setText(e.target.value)}
      onBlur={() => { setFocus(false); commit(); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`input-base text-right font-mono-nums ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${className}`}
    />
  );
}

export function SectionCard({ title, subtitle, actions, children, className = '' }: {
  title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`fin-card mb-6 ${className}`}>
      <div className="p-5 border-b border-border flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[14px] font-semibold text-foreground">{title}</div>
          {subtitle && <div className="text-[11px] text-muted-foreground">{subtitle}</div>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export const TH = 'text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap';
export const TD = 'px-4 py-3 whitespace-nowrap';
