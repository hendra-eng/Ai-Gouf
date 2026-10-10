'use client';

import React, { useMemo, useState } from 'react';
import { CheckCircle2, Plus, Download } from 'lucide-react';
import TransactionDrawer from '../../components/TransactionDrawer';
import type { Transaction } from '../../components/transactionData';
import { formatIDR, formatDate } from '../../lib/groupAnalytics';
import OtherTabs from '../components/OtherTabs';
import { useOtherWorkspace, OtherActionButtons, type OtherWorkspace } from '../components/OtherWorkspace';
import {
  buildOtherExceptions, allowedActions, EXCEPTION_TYPES, REMEDIATION,
  type OtherException, type ExceptionSeverity, type ExceptionType,
} from '../lib/otherJournals';

// EXCEPTIONS = papan triase. Temuan dikelompokkan per prioritas (kolom), tiap
// kartu menyertakan saran cara memperbaikinya. Chip jenis temuan di atas
// memperlihatkan sebaran masalah dan berfungsi sebagai filter.

const COLUMNS: { key: ExceptionSeverity; label: string; hint: string; head: string; dot: string }[] = [
  { key: 'High', label: 'High', hint: 'Menghalangi posting / merusak angka', head: 'border-rose-500', dot: 'bg-rose-500' },
  { key: 'Medium', label: 'Medium', hint: 'Perlu tindak lanjut', head: 'border-amber-500', dot: 'bg-amber-500' },
  { key: 'Low', label: 'Low', hint: 'Perapian data', head: 'border-slate-400', dot: 'bg-slate-400' },
];
const COL_LIMIT = 6;

function ExceptionCard({ e, onOpen, ws }: { e: OtherException; onOpen: () => void; ws: OtherWorkspace }) {
  const j = e.journal;
  const canEdit = allowedActions(j).includes('edit');
  // Tombol perbaikan langsung sesuai jenis temuan
  const fix: React.ReactNode = (() => {
    switch (e.type) {
      case 'Draft Menunggu Approval':
        return <OtherActionButtons journal={j} ws={ws} only={['approve', 'reject']} />;
      case 'Perlu Ditinjau':
        return canEdit ? (
          <button disabled={ws.busy} onClick={() => ws.clearNotes(j)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-medium disabled:opacity-50"><CheckCircle2 size={12} /> Tandai Selesai</button>
        ) : null;
      case 'Jurnal Tidak Balance':
      case 'Akun Belum Dipetakan':
      case 'Tanpa Nomor Jurnal':
        return canEdit ? <OtherActionButtons journal={j} ws={ws} only={['edit']} /> : null;
      default:
        return null;
    }
  })();
  return (
    <div className="rounded-lg border border-border bg-card p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">{e.type}</p>
        <span className="font-mono text-xs text-foreground shrink-0">{formatIDR(e.journal.amount, true)}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        <span className="font-mono text-teal-600">{e.journal.jeId}</span> · {formatDate(e.journal.date)} · {e.journal.party || '—'}
      </p>
      <p className="text-xs text-foreground">{e.detail}</p>
      <p className="text-[11px] text-muted-foreground border-l-2 border-border pl-2">{REMEDIATION[e.type]}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onOpen} className="text-xs text-blue-600 hover:underline">Lihat jurnal →</button>
        {fix}
      </div>
    </div>
  );
}

export default function OtherExceptionsPage() {
  const ws = useOtherWorkspace();
  const exceptions = useMemo(() => buildOtherExceptions(ws.journals), [ws.journals]);
  const approvable = useMemo(
    () => exceptions.filter((e) => e.type === 'Draft Menunggu Approval' && e.journal.balanced).map((e) => e.journal),
    [exceptions],
  );
  const [typeFilter, setTypeFilter] = useState<ExceptionType | null>(null);
  const [expanded, setExpanded] = useState<Set<ExceptionSeverity>>(new Set());
  const [selected, setSelected] = useState<Transaction | null>(null);

  const typeCounts = useMemo(() => {
    const m = new Map<ExceptionType, number>();
    exceptions.forEach((e) => m.set(e.type, (m.get(e.type) ?? 0) + 1));
    return m;
  }, [exceptions]);

  const filtered = typeFilter ? exceptions.filter((e) => e.type === typeFilter) : exceptions;
  const maxCount = Math.max(1, ...Array.from(typeCounts.values()));

  const toggle = (k: ExceptionSeverity) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="space-y-5">
      <OtherTabs activeTab="exceptions" exceptionCount={exceptions.length} />
      {ws.dialogs}
      {ws.error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Gagal memuat jurnal Other: {ws.error}</div>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button onClick={ws.openNew} className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90"><Plus size={13} /> Jurnal Baru</button>
        <button disabled={ws.busy || approvable.length === 0} onClick={() => ws.act('approve', approvable)} className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40"><CheckCircle2 size={13} /> Approve Semua Draft ({approvable.length})</button>
        <button onClick={() => ws.exportCsv(Array.from(new Map(filtered.map((e) => [e.journal.id, e.journal])).values()), 'jurnal-other-exceptions')} className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted"><Download size={13} /> CSV</button>
      </div>

      {ws.loading && ws.journals.length === 0 ? (
        <div className="card-elevated-md rounded-xl py-20 text-center text-sm text-muted-foreground">Memuat jurnal Other…</div>
      ) : exceptions.length === 0 ? (
        <div className="card-elevated-md rounded-xl py-20 flex flex-col items-center gap-3 text-center">
          <CheckCircle2 size={40} className="text-emerald-500" />
          <p className="text-sm font-semibold text-foreground">Semua jurnal Other dalam kondisi baik</p>
          <p className="text-xs text-muted-foreground">Tidak ada temuan yang perlu ditindaklanjuti.</p>
        </div>
      ) : (
        <>
          {/* Sebaran jenis temuan (juga filter) */}
          <div className="card-elevated-md rounded-xl p-5">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-bold text-foreground">Sebaran Jenis Temuan</h2>
              <p className="text-xs text-muted-foreground">{exceptions.length} temuan{typeFilter ? ` · filter: ${typeFilter}` : ''}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
              {EXCEPTION_TYPES.map((t) => {
                const n = typeCounts.get(t) ?? 0;
                const active = typeFilter === t;
                return (
                  <button
                    key={t}
                    disabled={n === 0}
                    onClick={() => setTypeFilter(active ? null : t)}
                    className={`text-left rounded-lg border px-3 py-2.5 transition-colors disabled:opacity-40 ${active ? 'border-blue-500 bg-blue-50' : 'border-border hover:bg-muted'}`}
                  >
                    <p className="text-xs text-foreground leading-tight">{t}</p>
                    <p className="text-xl font-bold font-mono text-foreground mt-1">{n}</p>
                    <div className="w-full h-1 bg-slate-100 rounded-full mt-1.5">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${(n / maxCount) * 100}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Papan triase per prioritas */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
            {COLUMNS.map((col) => {
              const items = filtered.filter((e) => e.severity === col.key);
              const open = expanded.has(col.key);
              const shown = open ? items : items.slice(0, COL_LIMIT);
              return (
                <div key={col.key} className="rounded-xl bg-muted/40 p-3 space-y-3">
                  <div className={`border-t-4 ${col.head} bg-card rounded-lg px-4 py-3 flex items-center justify-between`}>
                    <div>
                      <p className="text-sm font-bold text-foreground flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${col.dot}`} />{col.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{col.hint}</p>
                    </div>
                    <span className="text-2xl font-bold font-mono text-foreground">{items.length}</span>
                  </div>
                  {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">Tidak ada temuan.</p>}
                  {shown.map((e) => <ExceptionCard key={e.id} e={e} ws={ws} onOpen={() => setSelected(e.journal.lines[0])} />)}
                  {items.length > COL_LIMIT && (
                    <button onClick={() => toggle(col.key)} className="w-full text-xs text-blue-600 py-1.5 hover:underline">
                      {open ? 'Ringkas' : `Tampilkan ${items.length - COL_LIMIT} lainnya`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {selected && <TransactionDrawer transaction={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
