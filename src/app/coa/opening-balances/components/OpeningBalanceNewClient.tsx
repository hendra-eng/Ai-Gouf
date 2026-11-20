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
import PageHeading from '@/components/shared/PageHeading';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

const inputCls =
  'w-full rounded-lg border border-neutral-500 bg-white px-2.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 ' +
  'transition-shadow focus:border-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-800 disabled:bg-neutral-50 disabled:text-neutral-400';
const labelCls = 'block text-xs font-semibold text-neutral-900 mb-1.5';
// Kartu bergaya Sales: garis hitam tipis di atas, border netral.
const cardCls = 'relative overflow-hidden rounded-lg border border-neutral-400 bg-white shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-neutral-800';

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
    <div className={`${salesFont.className} min-h-screen bg-background`}>
      <div>
        <div className="mx-auto max-w-screen-2xl space-y-5 px-6 pt-5 lg:px-8 xl:px-10">
          <nav className="flex items-center gap-1 text-xs font-medium text-neutral-500">
            <ListTree size={13} />
            <Link href="/coa" className="hover:text-neutral-900">Chart of Accounts</Link>
            <ChevronRight size={12} />
            <Link href="/coa/opening-balances" className="hover:text-neutral-900">Opening balances</Link>
            <ChevronRight size={12} />
            <span className="font-semibold text-neutral-900">New</span>
          </nav>
          <div className="flex items-start gap-3">
            <Link href="/coa/opening-balances" title="Back" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
              <ArrowLeft size={18} />
            </Link>
            <PageHeading
              title="New Opening Balance"
              description="Step 1 of 2 — set the period and branch. Balances per account come next."
            />
          </div>
        </div>
      </div>

      {!activeClientId ? (
        <div className="mx-auto max-w-md px-6 py-16 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200"><Building2 size={20} /></span>
          <p className="text-sm font-semibold text-neutral-900">No client selected</p>
          <p className="mt-1 text-xs text-neutral-500">Select a client in the header first.</p>
        </div>
      ) : (
        <form onSubmit={simpan} className="mx-auto grid max-w-screen-2xl grid-cols-1 gap-6 px-6 pt-5 pb-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8 xl:px-10">
          <div className="space-y-5">
            <section className={`${cardCls} p-6`}>
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-900"><CalendarDays size={16} className="text-neutral-700" /> Period</h2>
              <label className={labelCls}>Fiscal year</label>
              <div className="inline-flex items-center rounded-lg border border-neutral-500 bg-white">
                <button type="button" onClick={() => setTahun(t => t - 1)} className="flex h-10 w-10 items-center justify-center text-neutral-500 hover:text-neutral-900"><Minus size={15} /></button>
                <span className="w-20 text-center font-mono text-base font-bold tabular-nums text-neutral-900">{tahun}</span>
                <button type="button" onClick={() => setTahun(t => t + 1)} className="flex h-10 w-10 items-center justify-center text-neutral-500 hover:text-neutral-900"><Plus size={15} /></button>
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
                    className={`rounded-lg border px-4 py-3 text-left transition-colors ${mode === v ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-300 bg-white hover:border-neutral-500 hover:bg-neutral-50'}`}
                  >
                    <span className={`block text-sm font-semibold ${mode === v ? 'text-neutral-900' : 'text-neutral-800'}`}>{judul}</span>
                    <span className="mt-0.5 block text-[11px] text-neutral-500">{hint}</span>
                  </button>
                ))}
              </div>
              {mode === 'mid_year' && (
                <div className="mt-4 max-w-xs">
                  <label className={labelCls}>Cut-off date</label>
                  <input type="date" value={tanggalTengah} min={`${tahun}-01-01`} max={batasAkhir} onChange={e => setTanggalTengah(e.target.value)} className={inputCls} />
                  {!tanggalValid && <p className="mt-1 text-[11px] text-rose-600">Must be between 1 Jan and 30 Dec {tahun}.</p>}
                </div>
              )}
            </section>

            <section className={`${cardCls} p-6`}>
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-900"><GitBranch size={16} className="text-neutral-700" /> Branch</h2>
              <div className="inline-flex rounded-lg border border-neutral-500 bg-white p-0.5">
                {([[false, 'No branch'], [true, 'Specific branch']] as const).map(([v, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setPakaiCabang(v)}
                    className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${pakaiCabang === v ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'}`}
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
                        <button key={b} type="button" onClick={() => setCabang(b)} className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cabang === b ? 'bg-neutral-800 text-white ring-neutral-800' : 'bg-white text-neutral-700 ring-neutral-500 hover:ring-neutral-800'}`}>{b}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <p className="mt-3 text-[11px] text-neutral-500">One opening balance per fiscal year per branch. The branch is stored as the cost center on the opening journal.</p>
            </section>

            <section className={`${cardCls} p-6`}>
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-900"><Scale size={16} className="text-neutral-700" /> Suspense &amp; reference</h2>
              <label className={labelCls}>Suspense account <span className="font-normal text-neutral-500">(optional now)</span></label>
              <SuspenseSelect accounts={accounts} value={suspenseId} onChange={setSuspenseId} className={inputCls} />
              <p className="mt-1 text-[11px] text-neutral-500">If total debit ≠ total credit when posting, the difference is parked here for you to resolve later.</p>
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
            <div className={`${cardCls} p-5`}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Summary</p>
              <dl className="mt-3 space-y-2.5">
                {ringkasan.map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3 text-xs">
                    <dt className="text-neutral-500">{k}</dt>
                    <dd className="text-right font-medium text-neutral-900">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-neutral-400 bg-neutral-50 p-4 text-[11px] font-medium leading-relaxed text-neutral-700">
              <Info size={14} className="mt-px shrink-0 text-neutral-700" />
              Posting creates an “Opening Balance” journal dated on the cut-off, so financial statements pick it up automatically.
            </div>
            <button
              type="submit"
              disabled={submitting || !tanggalValid}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-800 bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
              Continue to balances
            </button>
            <Link href="/coa/opening-balances" className="block w-full rounded-lg px-4 py-2 text-center text-sm font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900">Cancel</Link>
          </aside>
        </form>
      )}
    </div>
  );
}