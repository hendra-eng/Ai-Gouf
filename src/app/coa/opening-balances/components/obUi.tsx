import React from 'react';
import { Check, CheckCircle2, ChevronDown, Lock, PencilLine, Search } from 'lucide-react';
import type { CoaAccount } from '@/lib/coaStore';
import type { OpeningBalanceStatus } from '@/lib/openingBalanceStore';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

/** Pilih akun penampung selisih -- combobox dengan pencarian (kode / nama / klasifikasi),
 *  karena COA klien bisa ratusan akun. Equity & Liability ditaruh paling atas
 *  (biasanya "Opening Balance Equity" / akun suspense). `className` = gaya tombol pemicu. */
export function SuspenseSelect({ accounts, value, onChange, disabled, className }: {
  accounts: CoaAccount[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const [buka, setBuka] = React.useState(false);
  const [cari, setCari] = React.useState('');
  const [aktif, setAktif] = React.useState(0);
  const wadahRef = React.useRef<HTMLDivElement>(null);
  const cariRef = React.useRef<HTMLInputElement>(null);
  const daftarRef = React.useRef<HTMLDivElement>(null);

  const terpilih = accounts.find(a => a.id === value) ?? null;

  // Urutan grup: EQUITY, LIABILITY, lalu sisanya alfabetis. Hasil diratakan supaya navigasi keyboard gampang.
  const grup = React.useMemo(() => {
    const urut = ['EQUITY', 'LIABILITY'];
    const q = cari.trim().toLowerCase();
    const peta = new Map<string, CoaAccount[]>();
    for (const a of accounts) {
      if (!a.is_active && a.id !== value) continue;
      if (q && !`${kodeAkun(a.acc_no)} ${a.acc_no} ${a.account_name} ${a.account_classification}`.toLowerCase().includes(q)) continue;
      peta.set(a.account_classification, [...(peta.get(a.account_classification) ?? []), a]);
    }
    return [...peta.entries()].sort(([a], [b]) => {
      const ia = urut.indexOf(a), ib = urut.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }, [accounts, cari, value]);
  const rata = React.useMemo(() => grup.flatMap(([, list]) => list), [grup]);

  React.useEffect(() => {
    if (!buka) return;
    setCari('');
    setAktif(0);
    requestAnimationFrame(() => cariRef.current?.focus());
    const tutupLuar = (e: MouseEvent) => {
      if (wadahRef.current && !wadahRef.current.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener('mousedown', tutupLuar);
    return () => document.removeEventListener('mousedown', tutupLuar);
  }, [buka]);

  React.useEffect(() => { setAktif(0); }, [cari]);
  React.useEffect(() => {
    daftarRef.current?.querySelector<HTMLElement>(`[data-idx="${aktif}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [aktif]);

  const pilih = (id: string) => { onChange(id); setBuka(false); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAktif(i => Math.min(i + 1, rata.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAktif(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rata[aktif]) pilih(rata[aktif].id); }
    else if (e.key === 'Escape') { e.preventDefault(); setBuka(false); }
  };

  let idx = -1;
  return (
    <div ref={wadahRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setBuka(b => !b)}
        className={`${className ?? ''} flex items-center justify-between gap-2 text-left`}
        aria-haspopup="listbox"
        aria-expanded={buka}
      >
        <span className={`truncate ${terpilih ? 'text-neutral-900' : 'text-neutral-400'}`}>
          {terpilih ? `${kodeAkun(terpilih.acc_no)} · ${terpilih.account_name}` : '— Choose a suspense account —'}
        </span>
        <ChevronDown size={14} className="shrink-0 text-neutral-500" />
      </button>
      {buka && (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-lg border border-neutral-300 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
            <Search size={14} className="shrink-0 text-neutral-500" />
            <input
              ref={cariRef}
              value={cari}
              onChange={e => setCari(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search account code or name..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
          </div>
          <div ref={daftarRef} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {value && !cari && (
              <button type="button" onClick={() => pilih('')}
                className="block w-full px-3 py-1.5 text-left text-xs text-neutral-500 hover:bg-neutral-50">
                Clear selection
              </button>
            )}
            {rata.length === 0 && <p className="px-3 py-4 text-center text-xs text-neutral-500">No accounts match &quot;{cari}&quot;.</p>}
            {grup.map(([kelas, list]) => (
              <div key={kelas}>
                <p className="sticky top-0 bg-neutral-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-neutral-600">{kelas}</p>
                {list.map(a => {
                  idx += 1;
                  const i = idx;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="option"
                      aria-selected={a.id === value}
                      data-idx={i}
                      onMouseEnter={() => setAktif(i)}
                      onClick={() => pilih(a.id)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === aktif ? 'bg-neutral-100' : ''}`}
                    >
                      <span className="shrink-0 font-mono text-xs text-neutral-500">{kodeAkun(a.acc_no)}</span>
                      <span className="flex-1 truncate">{a.account_name}</span>
                      {a.id === value && <Check size={14} className="shrink-0 text-neutral-800" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS: Record<OpeningBalanceStatus, { label: string; cls: string; icon: React.ElementType }> = {
  draft: { label: 'Draft', cls: 'bg-amber-50 text-amber-700 ring-amber-600/20', icon: PencilLine },
  posted: { label: 'Posted', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', icon: CheckCircle2 },
  locked: { label: 'Locked', cls: 'bg-slate-100 text-slate-700 ring-slate-600/20', icon: Lock },
};

export function StatusBadge({ status }: { status: OpeningBalanceStatus }) {
  const s = STATUS[status] ?? STATUS.draft;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${s.cls}`}>
      <Icon size={11} /> {s.label}
    </span>
  );
}

export function branchLabel(branch: string | null): string {
  return branch ? `Branch ${branch}` : 'No branch';
}

const fmtTanggal = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/** "2024-12-31" -> "31 Dec 2024" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return fmtTanggal.format(new Date(y, m - 1, d));
}