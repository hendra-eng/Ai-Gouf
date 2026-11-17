'use client';

// Finance > FX Revaluation (Fase 3A): revaluasi akhir periode saldo AR/AP valas.
// Pratinjau (tidak menyimpan apa pun) -> posting jurnal revaluasi + jurnal pembalik otomatis di hari berikutnya.
// Riwayat run + pembatalan. Backend: modules/finance/fx_revaluation_v1.py.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Info, Loader2, RefreshCcw, TriangleAlert, Undo2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import { fmtRate } from '@/lib/exchangeRateStore';
import {
  cancelRevaluation, fetchRevaluationRuns, previewRevaluation, runRevaluation, useFxRevaluationData,
  type RevalPreview, type RevalRun,
} from '@/lib/fxRevaluationStore';
import { btnOutline, btnPrimary, btnSmall, inputCls } from '@/components/arap/arapUi';
import { FormField } from '@/components/shared/moduleUi';

const LEVEL_POST = 4;
const KOSONG_RUN: RevalRun[] = [];
const idr = (n: number) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const valas = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const tgl = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');

/** Akhir bulan lalu (default tanggal revaluasi), format yyyy-mm-dd tanpa geser zona waktu. */
function akhirBulanLalu(): string {
  const d = new Date();
  const akhir = new Date(d.getFullYear(), d.getMonth(), 0);
  return `${akhir.getFullYear()}-${String(akhir.getMonth() + 1).padStart(2, '0')}-${String(akhir.getDate()).padStart(2, '0')}`;
}

function bisaPosting(role: string | undefined): boolean {
  if (!role) return false;
  if (role === 'super_admin') return true;
  return Number(role.match(/^tahap_(\d+)$/)?.[1] ?? 0) >= LEVEL_POST;
}

const warnaSelisih = (n: number) => (n > 0 ? 'text-emerald-700' : n < 0 ? 'text-red-600' : 'text-muted-foreground');

export default function FxRevaluationClient() {
  const { user } = useAuth();
  const { activeClientId, hydrated } = useActiveClient();
  const [asOf, setAsOf] = useState(akhirBulanLalu);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [catatan, setCatatan] = useState('');
  const [hasil, setHasil] = useState<RevalPreview | null>(null);
  const [menghitung, setMenghitung] = useState(false);
  const [memposting, setMemposting] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const bisaPost = bisaPosting(user?.role);

  const runs = useFxRevaluationData<RevalRun[]>(activeClientId ? `runs:${activeClientId}` : null, s => fetchRevaluationRuns(activeClientId as string, s), KOSONG_RUN);

  const ratesManual = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [mu, v] of Object.entries(manual)) {
      const n = Number(v.replace(',', '.'));
      if (v.trim() && Number.isFinite(n) && n > 0) out[mu] = n;
    }
    return out;
  }, [manual]);

  const hitung = async () => {
    if (!activeClientId) return;
    setMenghitung(true); setGalat(null);
    try { setHasil(await previewRevaluation(activeClientId, asOf, ratesManual)); }
    catch (e) { setHasil(null); setGalat((e as Error).message); }
    finally { setMenghitung(false); }
  };

  const posting = async () => {
    if (!activeClientId || !hasil) return;
    const pesan = `Post FX revaluation as of ${tgl(asOf)}?\n\nA journal dated ${tgl(asOf)} and an automatic reversal dated ${tgl(hasil.reversal_date)} will be posted to the general ledger.`;
    if (!window.confirm(pesan)) return;
    setMemposting(true);
    try {
      const r = await runRevaluation(activeClientId, asOf, ratesManual, catatan);
      toast.success(`Posted ${r.journal_number} and reversal ${r.reversal_journal_number}.`);
      setHasil(await previewRevaluation(activeClientId, asOf, ratesManual));
    } catch (e) { toast.error((e as Error).message); }
    finally { setMemposting(false); }
  };

  const batalkan = async (r: RevalRun) => {
    if (!activeClientId) return;
    const alasan = window.prompt(`Cancel the revaluation as of ${tgl(r.as_of)}? Both journals are removed from the ledger. Reason (optional):`, '');
    if (alasan === null) return;
    try {
      await cancelRevaluation(activeClientId, r.id, alasan);
      toast.success('FX revaluation cancelled.');
      if (hasil) setHasil(await previewRevaluation(activeClientId, asOf, ratesManual));
    } catch (e) { toast.error((e as Error).message); }
  };

  const mataUang = hasil ? Array.from(new Set([...hasil.rates.map(r => r.currency), ...hasil.missing_rates])) : [];

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">FX Revaluation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Period-end revaluation of open foreign-currency invoices and bills at the closing rate. The unrealized gain or loss is posted on the period-end date and
            reversed automatically the next day, so settlements keep using the invoice rate.
          </p>
        </div>

        {!bisaPost && user && (
          <div className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">
            <Info size={14} className="mt-0.5 shrink-0" /> Posting or cancelling a revaluation needs Manager level or above. You can preview it here.
          </div>
        )}
        {hydrated && !activeClientId && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">Select a client first.</div>
        )}

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <FormField label="As of date" hint="Usually the last day of the month.">
              <input type="date" value={asOf} onChange={e => { setAsOf(e.target.value); setHasil(null); }} className={inputCls} />
            </FormField>
            {mataUang.map(mu => {
              const dariMaster = hasil?.rates.find(r => r.currency === mu && r.source === 'master');
              return (
                <FormField key={mu} label={`${mu} closing rate (IDR)`}
                  hint={dariMaster ? `Master ${tgl(dariMaster.rate_date)}: ${fmtRate(dariMaster.rate)}. Type a value to override.` : 'No recent rate on file: enter one.'}>
                  <input inputMode="decimal" value={manual[mu] ?? ''} onChange={e => setManual(m => ({ ...m, [mu]: e.target.value }))}
                    placeholder={dariMaster ? fmtRate(dariMaster.rate) : 'e.g. 16200'} className={inputCls} />
                </FormField>
              );
            })}
            <div className="flex items-end gap-2 md:col-start-4">
              <button onClick={hitung} disabled={!activeClientId || !asOf || menghitung} className={btnPrimary}>
                {menghitung ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Preview
              </button>
            </div>
          </div>
        </section>

        {galat && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{galat}</div>}

        {hasil && (
          <>
            {hasil.issues.length > 0 && (
              <div className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {hasil.issues.map(m => <div key={m} className="flex items-start gap-2"><TriangleAlert size={14} className="mt-0.5 shrink-0" /> {m}</div>)}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Kartu judul="Unrealized gain" nilai={hasil.totals.gain} warna="text-emerald-700" />
              <Kartu judul="Unrealized loss" nilai={hasil.totals.loss} warna="text-red-600" />
              <Kartu judul="Net effect on profit" nilai={hasil.totals.net} warna={warnaSelisih(hasil.totals.net)} />
            </div>

            <section className="rounded-2xl border border-border bg-card shadow-sm">
              <div className="px-5 pb-3 pt-5">
                <h2 className="text-lg font-bold text-foreground">Open foreign-currency documents</h2>
                <p className="text-xs text-muted-foreground">{hasil.totals.document_count} document{hasil.totals.document_count === 1 ? '' : 's'} open on {tgl(hasil.as_of)}. Outstanding is counted as of that date.</p>
              </div>
              <div className="overflow-x-auto px-5 pb-4">
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="border-y border-border bg-slate-50 text-left text-xs font-medium text-slate-600">
                      <th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Document</th><th className="px-3 py-2.5">Party</th>
                      <th className="px-3 py-2.5 text-right">Outstanding (FX)</th><th className="px-3 py-2.5 text-right">Booking rate</th>
                      <th className="px-3 py-2.5 text-right">Carried (IDR)</th><th className="px-3 py-2.5 text-right">Closing rate</th>
                      <th className="px-3 py-2.5 text-right">Revalued (IDR)</th><th className="px-3 py-2.5 text-right">Difference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {hasil.documents.length === 0 ? (
                      <tr><td colSpan={9} className="px-3 py-10 text-center text-xs text-muted-foreground">No open foreign-currency invoice or bill on this date.</td></tr>
                    ) : hasil.documents.map(d => (
                      <tr key={`${d.type}:${d.id}`} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2.5"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{d.type === 'ar' ? 'AR' : 'AP'}</span></td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-medium">{d.no}</td>
                        <td className="px-3 py-2.5">{d.party}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{d.currency} {valas(d.foreign_outstanding)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtRate(d.booking_rate)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{idr(d.carried_idr)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtRate(d.closing_rate)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{idr(d.revalued_idr)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${d.effect === 'gain' ? 'text-emerald-700' : d.effect === 'loss' ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {d.effect === 'gain' ? 'Gain ' : d.effect === 'loss' ? 'Loss ' : ''}{idr(Math.abs(d.difference))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {hasil.journal.length > 0 && (
              <section className="rounded-2xl border border-border bg-card shadow-sm">
                <div className="px-5 pb-3 pt-5">
                  <h2 className="text-lg font-bold text-foreground">Journal to post</h2>
                  <p className="text-xs text-muted-foreground">Dated {tgl(hasil.as_of)}. The automatic reversal (debit and credit swapped) is dated {tgl(hasil.reversal_date)}.</p>
                </div>
                <div className="overflow-x-auto px-5 pb-4">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-y border-border bg-slate-50 text-left text-xs font-medium text-slate-600">
                        <th className="px-3 py-2.5">Account</th><th className="px-3 py-2.5">Description</th>
                        <th className="px-3 py-2.5 text-right">Debit</th><th className="px-3 py-2.5 text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {hasil.journal.map((l, i) => (
                        <tr key={`${l.account_code}:${i}`}>
                          <td className="px-3 py-2.5"><span className="font-mono text-xs">{l.account_code}</span> {l.account_name}</td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">{l.description}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{l.debit ? idr(l.debit) : ''}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{l.credit ? idr(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <FormField label="Note (optional)" className="sm:w-96">
                <input value={catatan} onChange={e => setCatatan(e.target.value)} maxLength={500} placeholder="e.g. November closing" className={inputCls} />
              </FormField>
              <button onClick={posting} disabled={!bisaPost || !hasil.can_run || memposting} className={btnPrimary}
                title={!bisaPost ? 'Manager level or above is required.' : !hasil.can_run ? 'Resolve the notes above first.' : undefined}>
                {memposting && <Loader2 size={14} className="animate-spin" />} Post revaluation
              </button>
            </div>
          </>
        )}

        <section className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between px-5 pb-3 pt-5">
            <div>
              <h2 className="text-lg font-bold text-foreground">Revaluation history</h2>
              <p className="text-xs text-muted-foreground">Only one active revaluation can exist per date. Cancel it to run that date again.</p>
            </div>
            <button onClick={runs.refresh} className={btnOutline} aria-label="Refresh history"><RefreshCcw size={14} className={runs.loading ? 'animate-spin' : ''} /> Refresh</button>
          </div>
          {runs.error && <div className="mx-5 mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{runs.error}</div>}
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-y border-border bg-slate-50 text-left text-xs font-medium text-slate-600">
                  <th className="px-3 py-2.5">As of</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Gain</th>
                  <th className="px-3 py-2.5 text-right">Loss</th><th className="px-3 py-2.5 text-right">Docs</th><th className="px-3 py-2.5">Reversal</th>
                  <th className="px-3 py-2.5">By</th><th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.data.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-xs text-muted-foreground">{runs.loading ? 'Loading...' : 'No revaluation has been posted yet.'}</td></tr>
                ) : runs.data.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium">{tgl(r.as_of)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.status === 'posted' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{r.status === 'posted' ? 'Posted' : 'Cancelled'}</span>
                      {r.cancel_reason && <span className="ml-1.5 text-xs text-muted-foreground" title={r.cancel_reason}>{r.cancel_reason.slice(0, 40)}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{idr(r.total_gain)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-600">{idr(r.total_loss)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.document_count}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{tgl(r.reversal_date)}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.created_by_name || '-'}</td>
                    <td className="px-3 py-2.5 text-right">
                      {r.status === 'posted' && bisaPost && <button onClick={() => batalkan(r)} className={btnSmall}><Undo2 size={12} /> Cancel</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kartu({ judul, nilai, warna }: { judul: string; nilai: number; warna: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="text-xs font-medium text-muted-foreground">{judul}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${warna}`}>{idr(nilai)}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">IDR</div>
    </div>
  );
}
