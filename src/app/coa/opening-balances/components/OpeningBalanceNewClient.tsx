'use client';

// Halaman penuh "New opening balance" (/coa/opening-balances/new): isi header
// (tahun buku, tanggal cut-off, cabang, akun penampung), lalu lanjut ke editor
// saldo per akun (/coa/opening-balances/[id]).

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Building2, CalendarDays, ChevronRight, GitBranch, Info, ListTree, Loader2, Minus, Plus, Scale } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useClientCoa } from '@/lib/coaStore';
import { createOpeningBalance, fetchBranchSuggestions } from '@/lib/openingBalanceStore';
import { SuspenseSelect, formatDate } from './obUi';

const inputCls =
  'w-full text-sm rounded-lg border border-border bg-card px-3 py-2.5 text-foreground placeholder:text-slate-400 ' +
  'transition-shadow focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400';
const labelCls = 'block text-xs font-semibold text-foreground mb-1.5';

export default function OpeningBalanceNewClient() {
  const router = useRouter();
  const { activeClientId, activeClientName } = useActiveClient();
  const { accounts } = useClientCoa(activeClientId);

  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [mode, setMode] = useState<'year_start' | 'mid_year'>('year_start');
  const [tanggalTengah, setTanggalTengah] = useState('');
  const [pakaiCabang, setPakaiCabang] = useState(false);
  const [cabang, setCabang] = useState('');
  const [saranCabang, setSaranCabang] = useState<string[]>([]);
  const [suspenseId, setSuspenseId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!activeClientId) return;
    fetchBranchSuggestions(activeClientId).then(setSaranCabang).catch(() => setSaranCabang([]));
  }, [activeClientId]);

  const awalTahun = `${tahun - 1}-12-31`;
  const batasAkhir = `${tahun}-12-30`;
  const asOf = mode === 'year_start' ? awalTahun : tanggalTengah;
  const tanggalValid = mode === 'year_start' || (!!tanggalTengah && tanggalTengah >= `${tahun}-01-01` && tanggalTengah <= batasAkhir);

  // Default tanggal tengah tahun = akhir bulan lalu (dibatasi ke tahun buku).
  useEffect(() => {
    if (mode !== 'mid_year' || tanggalTengah) return;
    const d = new Date();
    const akhirBulanLalu = new Date(d.getFullYear(), d.getMonth(), 0);
    const iso = `${akhirBulanLalu.getFullYear()}-${String(akhirBulanLalu.getMonth() + 1).padStart(2, '0')}-${String(akhirBulanLalu.getDate()).padStart(2, '0')}`;
    setTanggalTengah(iso >= `${tahun}-01-01` && iso <= batasAkhir ? iso : `${tahun}-06-30`);
  }, [mode, tanggalTengah, tahun, batasAkhir]);

  const ringkasan = useMemo(() => [
    ['Client', activeClientName ?? '—'],
    ['Fiscal year', String(tahun)],
    ['Cut-off', asOf ? formatDate(asOf) : '—'],
    ['Branch', pakaiCabang ? (cabang.trim() || '—') : 'No branch'],
    ['Accounts allowed', mode === 'year_start' ? 'Balance sheet only' : 'Balance sheet + P&L (YTD)'],
  ], [activeClientName, tahun, asOf, pakaiCabang, cabang, mode]);

  async function simpan(e: React.FormEvent) {
    e.preventDefault();
    if (!activeClientId || submitting) return;
    if (!tanggalValid) {
      toast.error(`Cut-off date must be within ${tahun} (before 31 Dec).`);
      return;
    }
    if (pakaiCabang && !cabang.trim()) {
      toast.error('Enter a branch name, or switch to “No branch”.');
      return;
    }
    setSubmitting(true);
    try {
      const ob = await createOpeningBalance({
        client_id: activeClientId,
        fiscal_year: tahun,
        as_of_date: asOf,
        branch: pakaiCabang ? cabang.trim() : null,
        suspense_coa_id: suspenseId || null,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success('Opening balance created', { description: 'Now fill in the balance per account.' });
      router.push(`/coa/opening-balances/${ob.id}`);
    } catch (err) {
      toast.error('Failed to create opening balance', { description: err instanceof Error ? err.message : undefined });
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="pb-2">
        <div className="mx-auto max-w-5xl px-6">
          <nav className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
            <ListTree size={13} />
            <Link href="/coa" className="hover:text-foreground">Chart of Accounts</Link>
            <ChevronRight size={12} />
            <Link href="/coa/opening-balances" className="hover:text-foreground">Opening balances</Link>
            <ChevronRight size={12} />
            <span className="font-medium text-foreground">New</span>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/coa/opening-balances" title="Back" className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-slate-50 hover:text-foreground">
              <ArrowLeft size={16} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">New Opening Balance</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Step 1 of 2 — set the period and branch. Balances per account come next.</p>
            </div>
          </div>
        </div>
      </div>

      {!activeClientId ? (
        <div className="mx-auto max-w-md px-6 py-16 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Building2 size={20} /></span>
          <p className="text-sm font-semibold text-foreground">No client selected</p>
          <p className="mt-1 text-xs text-muted-foreground">Select a client in the header first.</p>
        </div>
      ) : (
        <form onSubmit={simpan} className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-5">
            <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><CalendarDays size={16} className="text-primary" /> Period</h2>
              <label className={labelCls}>Fiscal year</label>
              <div className="inline-flex items-center rounded-xl border border-border">
                <button type="button" onClick={() => setTahun(t => t - 1)} className="flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground"><Minus size={15} /></button>
                <span className="w-20 text-center font-mono text-base font-bold tabular-nums text-foreground">{tahun}</span>
                <button type="button" onClick={() => setTahun(t => t + 1)} className="flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground"><Plus size={15} /></button>
              </div>

              <label className={`${labelCls} mt-5`}>Cut-off</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {([
                  ['year_start', 'Start of fiscal year', `Balances as of ${formatDate(awalTahun)}. Balance sheet accounts only.`],
                  ['mid_year', 'Mid-year start', 'Client starts using the system during the year. P&L year-to-date allowed.'],
                ] as const).map(([v, judul, hint]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setMode(v)}
                    className={`rounded-xl border px-4 py-3 text-left transition-all ${mode === v ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100' : 'border-border hover:bg-slate-50'}`}
                  >
                    <span className={`block text-sm font-semibold ${mode === v ? 'text-primary' : 'text-foreground'}`}>{judul}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>
                  </button>
                ))}
              </div>
              {mode === 'mid_year' && (
                <div className="mt-4 max-w-xs">
                  <label className={labelCls}>Cut-off date</label>
                  <input type="date" value={tanggalTengah} min={`${tahun}-01-01`} max={batasAkhir} onChange={e => setTanggalTengah(e.target.value)} className={inputCls} />
                  {!tanggalValid && <p className="mt-1 text-[11px] text-red-600">Must be between 1 Jan and 30 Dec {tahun}.</p>}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><GitBranch size={16} className="text-primary" /> Branch</h2>
              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                {([[false, 'No branch'], [true, 'Specific branch']] as const).map(([v, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setPakaiCabang(v)}
                    className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${pakaiCabang === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {pakaiCabang && (
                <div className="mt-4 max-w-sm">
                  <label className={labelCls}>Branch name</label>
                  <input value={cabang} onChange={e => setCabang(e.target.value)} list="ob-branch-suggestions" placeholder="e.g. OL" className={inputCls} autoFocus />
                  <datalist id="ob-branch-suggestions">{saranCabang.map(b => <option key={b} value={b} />)}</datalist>
                  {saranCabang.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {saranCabang.map(b => (
                        <button key={b} type="button" onClick={() => setCabang(b)} className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cabang === b ? 'bg-blue-50 text-primary ring-blue-200' : 'bg-card text-slate-600 ring-border hover:bg-slate-50'}`}>{b}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">One opening balance per fiscal year per branch. The branch is stored as the cost center on the opening journal.</p>
            </section>

            <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground"><Scale size={16} className="text-primary" /> Suspense &amp; reference</h2>
              <label className={labelCls}>Suspense account <span className="font-normal text-muted-foreground">(optional now)</span></label>
              <SuspenseSelect accounts={accounts} value={suspenseId} onChange={setSuspenseId} className={inputCls} />
              <p className="mt-1 text-[11px] text-muted-foreground">If total debit ≠ total credit when posting, the difference is parked here for you to resolve later.</p>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Reference</label>
                  <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Audited balance sheet 2024" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Notes</label>
                  <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" className={inputCls} />
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Summary</p>
              <dl className="mt-3 space-y-2.5">
                {ringkasan.map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3 text-xs">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right font-medium text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="flex items-start gap-2 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-[11px] leading-relaxed text-blue-900">
              <Info size={14} className="mt-px shrink-0 text-blue-600" />
              Posting creates an “Opening Balance” journal dated on the cut-off, so financial statements pick it up automatically.
            </div>
            <button
              type="submit"
              disabled={submitting || !tanggalValid}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition-colors hover:bg-blue-800 disabled:opacity-60"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
              Continue to balances
            </button>
            <Link href="/coa/opening-balances" className="block w-full rounded-xl px-4 py-2 text-center text-sm font-medium text-muted-foreground hover:text-foreground">Cancel</Link>
          </aside>
        </form>
      )}
    </div>
  );
}
