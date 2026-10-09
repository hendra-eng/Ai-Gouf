import React from 'react';
import { CheckCircle2, Lock, PencilLine } from 'lucide-react';
import type { CoaAccount } from '@/lib/coaStore';
import type { OpeningBalanceStatus } from '@/lib/openingBalanceStore';

/** Pilih akun penampung selisih. Equity & Liability ditaruh paling atas
 *  (biasanya "Opening Balance Equity" / akun suspense). */
export function SuspenseSelect({ accounts, value, onChange, disabled, className }: {
  accounts: CoaAccount[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const urut = ['EQUITY', 'LIABILITY'];
  const grup = new Map<string, CoaAccount[]>();
  for (const a of accounts.filter(x => x.is_active || x.id === value)) {
    grup.set(a.account_classification, [...(grup.get(a.account_classification) ?? []), a]);
  }
  const kunci = [...grup.keys()].sort((a, b) => {
    const ia = urut.indexOf(a), ib = urut.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled} className={className}>
      <option value="">— Choose a suspense account —</option>
      {kunci.map(k => (
        <optgroup key={k} label={k}>
          {(grup.get(k) ?? []).map(a => <option key={a.id} value={a.id}>{a.acc_no} · {a.account_name}</option>)}
        </optgroup>
      ))}
    </select>
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
