'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search, CheckCircle2, AlertTriangle, XCircle, ChevronRight } from 'lucide-react';
import StatusBadge from '@/components/ui/StatusBadge';
import { useTransactions } from '../../context/TransactionsContext';
import { formatIDR, formatDate } from '../../lib/groupAnalytics';
import OtherTabs from '../components/OtherTabs';
import { buildOtherJournals, journalChecks, readinessOf, OTHER_STATUS_VARIANT, type Readiness, type OtherJournal } from '../lib/otherJournals';

// JOURNAL PREVIEW = antrian posting. Setiap jurnal belum-posting tampil seperti
// voucher yang siap ditinjau: baris debit-kredit + checklist kesiapan. Bagian
// atas memperlihatkan alur Draft → Perlu Perbaikan → Siap Diposting.

const STAGES: { key: Readiness; label: string; hint: string; bar: string; text: string; ring: string }[] = [
  { key: 'draft', label: 'Draft', hint: 'Menunggu approval', bar: 'border-purple-500', text: 'text-purple-600', ring: 'ring-purple-300' },
  { key: 'fix', label: 'Perlu Perbaikan', hint: 'Ada pemeriksaan gagal', bar: 'border-rose-500', text: 'text-rose-600', ring: 'ring-rose-300' },
  { key: 'ready', label: 'Siap Diposting', hint: 'Lolos semua pemeriksaan', bar: 'border-emerald-500', text: 'text-emerald-600', ring: 'ring-emerald-300' },
];
const PAGE = 12;

function Voucher({ j, stage }: { j: OtherJournal; stage: (typeof STAGES)[number] }) {
  const checks = journalChecks(j);
  const shown = j.lines.slice(0, 4);
  return (
    <div className={`card-elevated-md rounded-xl overflow-hidden border-l-4 ${stage.bar}`}>
      <div className="px-4 py-3 flex items-start justify-between gap-2 border-b border-border">
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold text-foreground">{j.jeId}</p>
          <p className="text-xs text-muted-foreground truncate">{formatDate(j.date)} · {j.party || '—'}</p>
        </div>
        <StatusBadge variant={OTHER_STATUS_VARIANT[j.status]} label={j.status} dot />
      </div>
      <div className="px-4 py-3">
        <p className="text-xs text-foreground mb-2 truncate">{j.description}</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pb-1 font-medium">Akun</th>
              <th className="pb-1 font-medium text-right">Debit</th>
              <th className="pb-1 font-medium text-right">Kredit</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="py-1.5 truncate max-w-[180px]">{l.accountName}</td>
                <td className="py-1.5 font-mono text-right">{l.debit ? formatIDR(l.debit, true) : ''}</td>
                <td className="py-1.5 font-mono text-right">{l.credit ? formatIDR(l.credit, true) : ''}</td>
              </tr>
            ))}
            {j.lines.length > shown.length && (
              <tr className="border-t border-border"><td colSpan={3} className="py-1.5 text-muted-foreground">+{j.lines.length - shown.length} baris lagi</td></tr>
            )}
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-1.5">Total</td>
              <td className="py-1.5 font-mono text-right">{formatIDR(j.debit, true)}</td>
              <td className="py-1.5 font-mono text-right">{formatIDR(j.credit, true)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 bg-muted/40 flex flex-wrap gap-x-4 gap-y-1">
        {checks.map((c) => (
          <span key={c.key} className="flex items-center gap-1 text-[11px]">
            {c.ok
              ? <CheckCircle2 size={12} className="text-emerald-500" />
              : c.blocking ? <XCircle size={12} className="text-rose-500" /> : <AlertTriangle size={12} className="text-amber-500" />}
            <span className={c.ok ? 'text-muted-foreground' : c.blocking ? 'text-rose-700 font-medium' : 'text-amber-700'}>{c.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function OtherJournalPreviewPage() {
  const { getByGroup } = useTransactions();
  const pending = useMemo(
    () => buildOtherJournals(getByGroup('other')).filter((j) => j.status === 'Unposted' || j.status === 'Draft'),
    [getByGroup],
  );
  const [stageFilter, setStageFilter] = useState<Readiness | null>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const grouped = useMemo(() => {
    const g: Record<Readiness, OtherJournal[]> = { draft: [], fix: [], ready: [] };
    pending.forEach((j) => g[readinessOf(j)].push(j));
    return g;
  }, [pending]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const order: Readiness[] = stageFilter ? [stageFilter] : ['fix', 'draft', 'ready'];
    return order.flatMap((k) =>
      grouped[k]
        .filter((j) => !q || [j.jeId, j.party, j.description].some((v) => (v || '').toLowerCase().includes(q)))
        .map((j) => ({ j, stage: STAGES.find((s) => s.key === k)! })),
    );
  }, [grouped, stageFilter, query]);

  useEffect(() => setLimit(PAGE), [stageFilter, query]);

  return (
    <div className="space-y-5">
      <OtherTabs activeTab="preview" />

      {/* Alur kesiapan posting */}
      <div className="flex flex-col md:flex-row items-stretch gap-2">
        {STAGES.map((s, i) => {
          const items = grouped[s.key];
          const total = items.reduce((sum, j) => sum + j.amount, 0);
          const active = stageFilter === s.key;
          return (
            <React.Fragment key={s.key}>
              <button
                onClick={() => setStageFilter(active ? null : s.key)}
                className={`flex-1 text-left card-elevated-md rounded-xl px-5 py-4 border-t-4 ${s.bar} transition-shadow ${active ? `ring-2 ${s.ring}` : ''}`}
              >
                <p className="text-xs text-muted-foreground">{s.hint}</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">{s.label}</p>
                <div className="flex items-baseline justify-between mt-2">
                  <span className={`text-3xl font-bold font-mono ${s.text}`}>{items.length}</span>
                  <span className="text-xs font-mono text-muted-foreground">{formatIDR(total, true)}</span>
                </div>
              </button>
              {i < STAGES.length - 1 && <ChevronRight className="hidden md:block self-center text-muted-foreground shrink-0" size={20} />}
            </React.Fragment>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari no. jurnal, pihak, deskripsi..."
            className="w-full pl-8 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
        </div>
        <p className="text-xs text-muted-foreground whitespace-nowrap">{visible.length} voucher{stageFilter ? ` · ${STAGES.find((s) => s.key === stageFilter)!.label}` : ''}</p>
      </div>

      {visible.length === 0 ? (
        <div className="card-elevated-md rounded-xl py-16 text-center text-sm text-muted-foreground">Tidak ada jurnal Other yang menunggu posting.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
            {visible.slice(0, limit).map(({ j, stage }) => <Voucher key={j.id} j={j} stage={stage} />)}
          </div>
          {visible.length > limit && (
            <div className="text-center">
              <button onClick={() => setLimit(limit + PAGE)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted">
                Tampilkan {Math.min(PAGE, visible.length - limit)} voucher lagi
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
