'use client';

// Finance > FX Transfers (Fase 3B/3C): rekening kas/bank valas + transfer antar rekening beda mata uang.
// Backend: modules/finance/fx_bank_v1.py. Revaluasi saldo bank valas ada di halaman FX Revaluation.

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRightLeft, Info, Loader2, RefreshCcw, TriangleAlert, Undo2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import { fmtRate } from '@/lib/exchangeRateStore';
import {
  fetchBankAccounts, fetchTransfers, postTransfer, previewTransfer, removeForeignAccount, reverseTransfer,
  saveForeignAccount, setForeignAmount, useFxBankData,
  type BankAccount, type BankAccountsResult, type FxTransfer, type TransferPreview,
} from '@/lib/fxBankStore';
import { btnOutline, btnPrimary, btnSmall, inputCls } from '@/components/arap/arapUi';
import { FormField } from '@/components/shared/moduleUi';

const LEVEL_POST = 4;
const AWAL: BankAccountsResult = { as_of: '', accounts: [] };
const KOSONG_TR: FxTransfer[] = [];
const idr = (n: number) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const valas = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const tgl = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const angka = (v: string) => { const n = Number(v.replace(',', '.')); return v.trim() && Number.isFinite(n) && n > 0 ? n : null; };

function bisaPosting(role: string | undefined): boolean {
  if (!role) return false;
  if (role === 'super_admin') return true;
  return Number(role.match(/^tahap_(\d+)$/)?.[1] ?? 0) >= LEVEL_POST;
}

interface Pengaturan { coa_id: string; label: string; currency: string; tracking_start: string; opening_foreign: string }

export default function FxTransfersClient() {
  const { user } = useAuth();
  const { activeClientId, hydrated } = useActiveClient();
  const bisaPost = bisaPosting(user?.role);
  const [asOf, setAsOf] = useState(hariIni);
  const [edit, setEdit] = useState<Pengaturan | null>(null);
  const [simpan, setSimpan] = useState(false);
  const [nominalTx, setNominalTx] = useState<Record<string, string>>({});

  const [dari, setDari] = useState('');
  const [ke, setKe] = useState('');
  const [tglTf, setTglTf] = useState(hariIni);
  const [jmlDari, setJmlDari] = useState('');
  const [jmlKe, setJmlKe] = useState('');
  const [kursMasuk, setKursMasuk] = useState('');
  const [catatan, setCatatan] = useState('');
  const [hasil, setHasil] = useState<TransferPreview | null>(null);
  const [menghitung, setMenghitung] = useState(false);
  const [memposting, setMemposting] = useState(false);

  const rek = useFxBankData<BankAccountsResult>(activeClientId ? `accounts:${activeClientId}:${asOf}` : null, s => fetchBankAccounts(activeClientId as string, asOf, s), AWAL);
  const riwayat = useFxBankData<FxTransfer[]>(activeClientId ? `transfers:${activeClientId}` : null, s => fetchTransfers(activeClientId as string, s), KOSONG_TR);
  const akun = rek.data.accounts;
  const akunDari = akun.find(a => a.coa_id === dari);
  const akunKe = akun.find(a => a.coa_id === ke);
  const bedaMu = !!akunDari && !!akunKe && akunDari.currency !== akunKe.currency;
  const perluKurs = bedaMu && akunKe?.currency !== 'IDR';
  const belumDikonversi = useMemo(() => akun.filter(a => (a.unconverted?.length ?? 0) > 0), [akun]);

  const input = () => {
    const a = angka(jmlDari); const b = angka(jmlKe);
    if (!dari || !ke || !a || !b) return null;
    return { transfer_date: tglTf, from_coa_id: dari, to_coa_id: ke, from_amount: a, to_amount: b, rate_in: perluKurs ? angka(kursMasuk) : null, notes: catatan.trim() || null };
  };

  const hitung = async () => {
    const v = input();
    if (!activeClientId || !v) { toast.error('Select both accounts and enter both amounts.'); return; }
    setMenghitung(true);
    try { setHasil(await previewTransfer(activeClientId, v)); }
    catch (e) { setHasil(null); toast.error((e as Error).message); }
    finally { setMenghitung(false); }
  };

  const posting = async () => {
    const v = input();
    if (!activeClientId || !v || !hasil?.can_post) return;
    if (!window.confirm(`Post this currency transfer dated ${tgl(tglTf)}? The journal goes straight to the general ledger.`)) return;
    setMemposting(true);
    try {
      const r = await postTransfer(activeClientId, v);
      toast.success(`Posted ${r.transfer.transfer_no}.`);
      setHasil(null); setJmlDari(''); setJmlKe(''); setKursMasuk(''); setCatatan('');
    } catch (e) { toast.error((e as Error).message); }
    finally { setMemposting(false); }
  };

  const simpanRekening = async () => {
    if (!activeClientId || !edit) return;
    const awal = edit.opening_foreign.trim() ? Number(edit.opening_foreign.replace(',', '.')) : 0;
    if (!Number.isFinite(awal) || awal < 0) { toast.error('Opening balance must be 0 or more.'); return; }
    setSimpan(true);
    try {
      await saveForeignAccount(activeClientId, { coa_id: edit.coa_id, currency: edit.currency.trim().toUpperCase(), tracking_start: edit.tracking_start, opening_foreign: awal });
      toast.success('Foreign-currency bank account saved.');
      setEdit(null);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSimpan(false); }
  };

  const lepas = async (a: BankAccount) => {
    if (!activeClientId || !window.confirm(`Remove the foreign-currency marker from ${a.account_code} ${a.account_name}?`)) return;
    try { await removeForeignAccount(activeClientId, a.coa_id); toast.success('Marker removed.'); }
    catch (e) { toast.error((e as Error).message); }
  };

  const isiNominal = async (id: string) => {
    const n = angka(nominalTx[id] ?? '');
    if (!activeClientId || !n) { toast.error('Enter the foreign amount.'); return; }
    try { await setForeignAmount(activeClientId, id, n); toast.success('Foreign amount saved.'); setNominalTx(m => ({ ...m, [id]: '' })); }
    catch (e) { toast.error((e as Error).message); }
  };

  const balik = async (t: FxTransfer) => {
    if (!activeClientId) return;
    const alasan = window.prompt(`Reverse ${t.transfer_no}? A reversal journal is posted today. Reason (optional):`, '');
    if (alasan === null) return;
    try { await reverseTransfer(activeClientId, t.id, null, alasan); toast.success(`${t.transfer_no} reversed.`); setHasil(null); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">FX Transfers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mark bank accounts that hold foreign currency, move money between accounts of different currencies, and keep each account&apos;s foreign balance and
            IDR book value. Balances of foreign-currency bank accounts are revalued together with receivables and payables on the FX Revaluation page.
          </p>
        </div>

        {!bisaPost && user && (
          <div className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">
            <Info size={14} className="mt-0.5 shrink-0" /> Setting up accounts, posting and reversing transfers needs Manager level or above. You can preview here.
          </div>
        )}
        {hydrated && !activeClientId && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">Select a client first.</div>
        )}

        {/* ---------- Rekening ---------- */}
        <section className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
            <div>
              <h2 className="text-lg font-bold text-foreground">Cash and bank accounts</h2>
              <p className="text-xs text-muted-foreground">Foreign balance is tracked from the tracking start date; the book value is the ledger balance in IDR.</p>
            </div>
            <div className="flex items-end gap-2">
              <FormField label="Balances as of"><input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={inputCls} /></FormField>
              <button onClick={rek.refresh} className={btnOutline} aria-label="Refresh accounts"><RefreshCcw size={14} className={rek.loading ? 'animate-spin' : ''} /></button>
            </div>
          </div>
          {rek.error && <div className="mx-5 mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{rek.error}</div>}
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-y border-border bg-slate-50 text-left text-xs font-medium text-slate-600">
                  <th className="px-3 py-2.5">Account</th><th className="px-3 py-2.5">Currency</th><th className="px-3 py-2.5">Tracking from</th>
                  <th className="px-3 py-2.5 text-right">Foreign balance</th><th className="px-3 py-2.5 text-right">Book value (IDR)</th>
                  <th className="px-3 py-2.5 text-right">Average rate</th><th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {akun.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-xs text-muted-foreground">{rek.loading ? 'Loading...' : 'No cash or bank account found for this client.'}</td></tr>
                ) : akun.map(a => (
                  <tr key={a.coa_id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5"><span className="font-mono text-xs">{a.account_code}</span> {a.account_name}</td>
                    <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${a.is_foreign ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-700'}`}>{a.currency}</span></td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{a.is_foreign ? tgl(a.tracking_start) : '-'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{a.is_foreign && a.foreign_balance !== undefined ? `${a.currency} ${valas(a.foreign_balance)}` : '-'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{a.is_foreign && a.carrying_idr != null ? idr(a.carrying_idr) : '-'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{a.average_rate ? fmtRate(a.average_rate) : '-'}</td>
                    <td className="px-3 py-2.5 text-right">
                      {bisaPost && (
                        <div className="flex justify-end gap-1.5">
                          <button className={btnSmall} onClick={() => setEdit({
                            coa_id: a.coa_id, label: `${a.account_code} ${a.account_name}`, currency: a.is_foreign ? a.currency : '',
                            tracking_start: a.tracking_start ?? hariIni(), opening_foreign: String(a.opening_foreign ?? 0),
                          })}>{a.is_foreign ? 'Edit' : 'Set as foreign'}</button>
                          {a.is_foreign && <button className={btnSmall} onClick={() => lepas(a)}>Remove</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {akun.filter(a => (a.issues?.length ?? 0) > 0).map(a => (
            <div key={a.coa_id} className="mx-5 mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" /> <span><b>{a.account_code}</b>: {a.issues?.join(' ')}</span>
            </div>
          ))}

          {edit && (
            <div className="mx-5 mb-5 rounded-xl border border-border bg-slate-50 p-4">
              <div className="mb-3 text-sm font-semibold text-foreground">{edit.label}</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <FormField label="Currency" hint="3-letter code, e.g. USD."><input value={edit.currency} maxLength={3} onChange={e => setEdit({ ...edit, currency: e.target.value.toUpperCase() })} className={inputCls} /></FormField>
                <FormField label="Tracking start" hint="Transactions from this date count toward the foreign balance."><input type="date" value={edit.tracking_start} onChange={e => setEdit({ ...edit, tracking_start: e.target.value })} className={inputCls} /></FormField>
                <FormField label="Opening foreign balance" hint="Balance in the account's currency before the tracking start date."><input inputMode="decimal" value={edit.opening_foreign} onChange={e => setEdit({ ...edit, opening_foreign: e.target.value })} className={inputCls} /></FormField>
                <div className="flex items-end gap-2">
                  <button onClick={simpanRekening} disabled={simpan || edit.currency.length !== 3} className={btnPrimary}>{simpan && <Loader2 size={14} className="animate-spin" />} Save</button>
                  <button onClick={() => setEdit(null)} className={btnOutline}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ---------- Transaksi tanpa nominal valas ---------- */}
        {belumDikonversi.length > 0 && (
          <section className="rounded-2xl border border-amber-200 bg-card shadow-sm">
            <div className="px-5 pb-3 pt-5">
              <h2 className="text-lg font-bold text-foreground">Transactions without a foreign amount</h2>
              <p className="text-xs text-muted-foreground">These Cash &amp; Bank transactions are on a foreign-currency account but carry no foreign amount. Enter it so the balance, transfers and revaluation are reliable.</p>
            </div>
            <div className="overflow-x-auto px-5 pb-4">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-y border-border bg-slate-50 text-left text-xs font-medium text-slate-600">
                    <th className="px-3 py-2.5">Account</th><th className="px-3 py-2.5">Transaction</th><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Description</th>
                    <th className="px-3 py-2.5 text-right">IDR amount</th><th className="px-3 py-2.5">Foreign amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {belumDikonversi.flatMap(a => (a.unconverted ?? []).map(t => (
                    <tr key={t.id}>
                      <td className="px-3 py-2.5 font-mono text-xs">{a.account_code}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-medium">{t.tx_number} <span className="text-xs text-muted-foreground">{t.direction === 'receipt' ? 'in' : 'out'}</span></td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{tgl(t.tx_date)}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{t.description || '-'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{idr(t.amount_idr)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{a.currency}</span>
                          <input inputMode="decimal" value={nominalTx[t.id] ?? ''} onChange={e => setNominalTx(m => ({ ...m, [t.id]: e.target.value }))} className={`${inputCls} max-w-[140px]`} placeholder="0.00" />
                          <button className={btnSmall} onClick={() => isiNominal(t.id)}>Save</button>
                        </div>
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ---------- Transfer baru ---------- */}
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-bold text-foreground">New currency transfer</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Money leaving a foreign-currency account is valued at its average cost. Any difference against the value received is booked as a realized FX gain or loss.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <FormField label="Date"><input type="date" value={tglTf} onChange={e => { setTglTf(e.target.value); setHasil(null); }} className={inputCls} /></FormField>
            <FormField label="From account">
              <select value={dari} onChange={e => { setDari(e.target.value); setHasil(null); }} className={inputCls}>
                <option value="">Select...</option>
                {akun.map(a => <option key={a.coa_id} value={a.coa_id}>{a.account_code} {a.account_name} ({a.currency})</option>)}
              </select>
            </FormField>
            <FormField label={`Amount sent${akunDari ? ` (${akunDari.currency})` : ''}`}>
              <input inputMode="decimal" value={jmlDari} onChange={e => { setJmlDari(e.target.value); setHasil(null); }} className={inputCls} placeholder="0.00" />
            </FormField>
            <div />
            <div />
            <FormField label="To account">
              <select value={ke} onChange={e => { setKe(e.target.value); setHasil(null); }} className={inputCls}>
                <option value="">Select...</option>
                {akun.filter(a => a.coa_id !== dari).map(a => <option key={a.coa_id} value={a.coa_id}>{a.account_code} {a.account_name} ({a.currency})</option>)}
              </select>
            </FormField>
            <FormField label={`Amount received${akunKe ? ` (${akunKe.currency})` : ''}`}>
              <input inputMode="decimal" value={jmlKe} onChange={e => { setJmlKe(e.target.value); setHasil(null); }} className={inputCls} placeholder="0.00" />
            </FormField>
            {perluKurs ? (
              <FormField label={`${akunKe?.currency} valuation rate (IDR)`} hint="Leave empty to use the latest master rate. Enter the actual rate to avoid a spread loss.">
                <input inputMode="decimal" value={kursMasuk} onChange={e => { setKursMasuk(e.target.value); setHasil(null); }} className={inputCls} placeholder="master rate" />
              </FormField>
            ) : <div />}
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <FormField label="Note (optional)" className="sm:w-96"><input value={catatan} onChange={e => setCatatan(e.target.value)} maxLength={500} className={inputCls} /></FormField>
            <button onClick={hitung} disabled={!activeClientId || menghitung} className={btnOutline}>
              {menghitung ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />} Preview
            </button>
            <button onClick={posting} disabled={!bisaPost || !hasil?.can_post || memposting} className={btnPrimary}
              title={!bisaPost ? 'Manager level or above is required.' : !hasil?.can_post ? 'Preview a valid transfer first.' : undefined}>
              {memposting && <Loader2 size={14} className="animate-spin" />} Post transfer
            </button>
          </div>

          {hasil && !hasil.can_post && (
            <div className="mt-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {hasil.issues.map(m => <div key={m} className="flex items-start gap-2"><TriangleAlert size={14} className="mt-0.5 shrink-0" /> {m}</div>)}
            </div>
          )}
          {hasil?.can_post && hasil.journal && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Ringkas judul="Value sent (IDR)" nilai={idr(hasil.value_out_idr ?? 0)} sub={hasil.from_average_rate ? `average rate ${fmtRate(hasil.from_average_rate)}` : undefined} />
                <Ringkas judul="Value received (IDR)" nilai={idr(hasil.value_in_idr ?? 0)} sub={hasil.rate_in ? `rate ${fmtRate(hasil.rate_in)}` : undefined} />
                <Ringkas judul={hasil.effect === 'gain' ? 'Realized FX gain' : hasil.effect === 'loss' ? 'Realized FX loss' : 'FX difference'} nilai={idr(Math.abs(hasil.fx_difference ?? 0))}
                  warna={hasil.effect === 'gain' ? 'text-emerald-700' : hasil.effect === 'loss' ? 'text-red-600' : undefined} />
                <Ringkas judul="Balance before" nilai={hasil.from_balance != null ? `${hasil.from?.currency} ${valas(hasil.from_balance)}` : '-'} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-y border-border bg-slate-50 text-left text-xs font-medium text-slate-600">
                      <th className="px-3 py-2.5">Account</th><th className="px-3 py-2.5">Description</th><th className="px-3 py-2.5 text-right">Debit</th><th className="px-3 py-2.5 text-right">Credit</th>
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
            </div>
          )}
        </section>

        {/* ---------- Riwayat ---------- */}
        <section className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between px-5 pb-3 pt-5">
            <h2 className="text-lg font-bold text-foreground">Transfer history</h2>
            <button onClick={riwayat.refresh} className={btnOutline} aria-label="Refresh history"><RefreshCcw size={14} className={riwayat.loading ? 'animate-spin' : ''} /> Refresh</button>
          </div>
          {riwayat.error && <div className="mx-5 mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{riwayat.error}</div>}
          <div className="overflow-x-auto px-5 pb-4">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-y border-border bg-slate-50 text-left text-xs font-medium text-slate-600">
                  <th className="px-3 py-2.5">No.</th><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">From</th><th className="px-3 py-2.5">To</th>
                  <th className="px-3 py-2.5 text-right">Sent</th><th className="px-3 py-2.5 text-right">Received</th><th className="px-3 py-2.5 text-right">FX gain / loss (IDR)</th>
                  <th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {riwayat.data.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-10 text-center text-xs text-muted-foreground">{riwayat.loading ? 'Loading...' : 'No currency transfer has been posted yet.'}</td></tr>
                ) : riwayat.data.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium">{t.transfer_no}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{tgl(t.transfer_date)}</td>
                    <td className="px-3 py-2.5"><span className="font-mono text-xs">{t.from_account_code}</span></td>
                    <td className="px-3 py-2.5"><span className="font-mono text-xs">{t.to_account_code}</span></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{t.from_currency} {valas(t.from_amount)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{t.to_currency} {valas(t.to_amount)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${t.effect === 'gain' ? 'text-emerald-700' : t.effect === 'loss' ? 'text-red-600' : 'text-muted-foreground'}`}>
                      {t.effect === 'gain' ? 'Gain ' : t.effect === 'loss' ? 'Loss ' : ''}{idr(Math.abs(t.fx_difference))}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${t.status === 'posted' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{t.status === 'posted' ? 'Posted' : 'Reversed'}</span>
                      {t.reversal_date && <span className="ml-1.5 text-xs text-muted-foreground">{tgl(t.reversal_date)}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {t.status === 'posted' && bisaPost && <button onClick={() => balik(t)} className={btnSmall}><Undo2 size={12} /> Reverse</button>}
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

function Ringkas({ judul, nilai, sub, warna }: { judul: string; nilai: string; sub?: string; warna?: string }) {
  return (
    <div className="rounded-xl border border-border bg-slate-50 px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground">{judul}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${warna ?? 'text-foreground'}`}>{nilai}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
