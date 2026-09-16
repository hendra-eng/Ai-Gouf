'use client';

// [BARU] Dropdown "Export" kecil khusus tab-tab baru di halaman
// /transactions, menggantikan `@/components/ui/ExportMenu` yang dipanggil
// di file-file tab tapi tidak pernah ada di project ini.
import React, { useEffect, useRef, useState } from 'react';
import { Download, ChevronDown, FileSpreadsheet, FileText, BookOpen } from 'lucide-react';

interface TabExportMenuProps {
  onExportCSV: () => void;
  onExportPDF: () => void;
  onExportGLSnapshot: () => void;
}

export default function TabExportMenu({ onExportCSV, onExportPDF, onExportGLSnapshot }: TabExportMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const items = [
    { label: 'Export CSV', icon: <FileSpreadsheet size={14} />, onClick: onExportCSV },
    { label: 'Export PDF Report', icon: <FileText size={14} />, onClick: onExportPDF },
    { label: 'Export GL Snapshot', icon: <BookOpen size={14} />, onClick: onExportGLSnapshot },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-600 bg-muted text-foreground rounded-lg hover:bg-muted/70 transition-colors duration-150 border border-border"
      >
        <Download size={14} />
        Export
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-card border border-border rounded-lg shadow-card-md z-30 overflow-hidden">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted transition-colors text-left"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
