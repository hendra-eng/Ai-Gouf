'use client';

// Detail 1 aset: nilai per tanggal, akun, riwayat jurnal FA, proyeksi
// penyusutan, plus aksi Edit, Dispose, jurnal perolehan, dan adjustment.

import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { fmtDate, fmtMonth, rupiah, todayIso } from '@/lib/receivablesPayablesStore';
import {
  fetchAssetDetail, fetchFaAccounts, JOURNAL_TYPE_LABEL, JOURNAL_TYPE_STYLE, lifeLabel, METHOD_LABEL, postAcquisition, postAdjustment, reverseJournal,
  STATUS_LABEL, STATUS_STYLE, useFaData, type AssetDetail, type CoaAccount, type Journal,
} from '@/lib/fixedAssetsStore';
import { btnOutline, btnPrimary, btnSmall, Drawer, Field, inputCls } from '@/components/arap/arapUi';
import { AccountSelect, FormField, Modal, Pill, ReasonDialog } from '@/components/shared/moduleUi';
import type { FaActions } from './FixedAssetsWorkspace';

export default function AssetDetailDrawer({ clientId, assetId, asOf, actions, onClose }: {
  clientId: string; assetId: string; asOf: string; actions: FaActions; onClose: () => void;
}) {
  const det = useFaData<AssetDetail | null>(`det:${clientId}:${assetId}:${asOf}`, s => fetchAssetDetail(clientId, assetId, asOf, s), null);
  const akun = useFaData<CoaAccount[]>(`acc:${clientId}`, s => fetchFaAccounts(clientId, s), []);
  const [mode, setMode] = useState<null | 'acquisition' | 'adjustment'>(null);
  const [balik, setBalik] = useState<Journal | null>(null);
  const [semuaJadwal, setSemuaJadwal] = useState(false);
  const a = det.data;

  return (
    <Drawer open onClose={onClose} title={a ? `${a.asset_code} · ${a.name}` : 'Loading...'} subtitle={a ? `${a.category ?? 'Uncategorized'} · ${a.location ?? 'No location'}` : undefined}
      footer={a && a.status !== 'disposed' ? <>
        {!a.acquisition_journal_id && <button type="button" className={btnSmall} onClick={() => setMode('acquisition')}>Post Acquisition Journal</button>}
        <button type="button" className={btnSmall} onClick={() => setMode('adjustment')}>Adjustment</button>
        <button type="button" className={btnSmall} onClick={() => actions.newDisposal(a.id)}>Dispose</button>
        <button type="button" className={`${btnSmall} border-transparent bg-[#0F7D4E] text-white hover:bg-[#0c6a42]`} onClick={() => actions.editAsset(a)}>Edit</button>
      </> : undefined}>
      {det.error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{det.error}</p>}
      {!a ? <div className="h-40 animate-pulse rounded-xl bg-slate-50" /> : <>
        <div className="flex flex-wrap items-center gap-2">
          <Pill label={STATUS_LABEL[a.display_status]} style={STATUS_STYLE[a.display_status]} />
          {a.issues.map(i => <Pill key={i} label={i} style="bg-amber-50 text-amber-700" />)}
        </div>
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-center">
          <div><p className="text-[11px] text-muted-foreground">Cost</p><p className="text-sm font-bold">{rupiah(a.cost)}</p></div>
          <div><p className="text-[11px] text-muted-foreground">Accumulated</p><p className="text-sm font-bold text-rose-600">{rupiah(a.accumulated_depreciation)}</p></div>
          <div><p className="text-[11px] text-muted-foreground">Net Book Value</p><p className="text-sm font-bold text-[#0F7D4E]">{rupiah(a.net_book_value)}</p></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Acquisition Date">{fmtDate(a.acquisition_date)}</Field>
          <Field label="Depreciation Start">{fmtDate(a.depreciation_start_date || a.acquisition_date)}</Field>
          <Field label="Method">{a.depreciation_method ? METHOD_LABEL[a.depreciation_method] : '—'}</Field>
          <Field label="Useful Life">{lifeLabel(a.useful_life_months)} · {lifeLabel(a.remaining_life_months)} left</Field>
          <Field label="Residual Value">{a.residual_value != null ? rupiah(a.residual_value) : <span className="text-amber-700">Not set</span>}</Field>
          <Field label="Monthly Depreciation">{rupiah(a.monthly_depreciation)}</Field>
          <Field label="Opening Accumulated">{rupiah(a.opening_accumulated_depreciation)}</Field>
          <Field label="Original Cost">{rupiah(a.original_cost)}</Field>
          <Field label="Branch / Department">{a.branch ?? '—'} / {a.department ?? '—'}</Field>
          <Field label="Custodian">{a.custodian ?? '—'}</Field>
          <Field label="Serial Number">{a.serial_number ?? '—'}</Field>
          <Field label="Supplier / Reference">{a.supplier ?? '—'} / {a.reference ?? '—'}</Field>
          <Field label="Asset Account">{a.asset_account ? `${a.asset_account.code} · ${a.asset_account.name}` : '—'}</Field>
          <Field label="Accumulated Dep. Account">{a.accum_account ? `${a.accum_account.code} · ${a.accum_account.name}` : '—'}</Field>
          <Field label="Depreciation Expense">{a.expense_account ? `${a.expense_account.code} · ${a.expense_account.name}` : '—'}</Field>
          {a.disposal_date && <Field label="Disposed">{fmtDate(a.disposal_date)} · {rupiah(a.disposal_value)}</Field>}
        </div>
        {a.description && <Field label="Description"><span className="whitespace-pre-line text-muted-foreground">{a.description}</span></Field>}

        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">Journal History</h4>
          {a.journals.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">No journals posted for this asset yet.</p>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border">
              {a.journals.map(j => (
                <div key={j.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{j.journal_no} <Pill label={JOURNAL_TYPE_LABEL[j.journal_type]} style={JOURNAL_TYPE_STYLE[j.journal_type]} />
                      {j.status === 'reversed' && <Pill label="Reversed" style="ml-1 bg-rose-50 text-rose-700" />}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDate(j.journal_date)} · {j.reference ?? '—'} · {j.posted_by_name ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{rupiah(j.amount)}</span>
                    {j.status === 'posted' && (j.journal_type === 'acquisition' || j.journal_type === 'adjustment') && (
                      <button type="button" className={btnSmall} onClick={() => setBalik(j)}>Reverse</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {a.schedule.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold text-foreground">Projected Depreciation <span className="font-normal text-muted-foreground">({a.schedule.length} months remaining)</span></h4>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5">Period</th><th className="py-1.5 text-right">Depreciation</th><th className="py-1.5 text-right">Accumulated</th><th className="py-1.5 text-right">Book Value</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {(semuaJadwal ? a.schedule : a.schedule.slice(0, 12)).map(s => (
                  <tr key={s.period}><td className="py-1.5">{fmtMonth(s.period.slice(0, 7))}</td><td className="py-1.5 text-right">{rupiah(s.depreciation)}</td>
                    <td className="py-1.5 text-right">{rupiah(s.accumulated)}</td><td className="py-1.5 text-right">{rupiah(s.nbv)}</td></tr>
                ))}
              </tbody>
            </table>
            {a.schedule.length > 12 && (
              <button type="button" onClick={() => setSemuaJadwal(x => !x)} className="mt-1 text-xs font-medium text-[#0F7D4E] hover:underline">
                {semuaJadwal ? 'Show less' : `Show all ${a.schedule.length} months`}
              </button>
            )}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">Created {fmtDate(a.created_at)} by {a.created_by_name ?? '—'}</p>
      </>}

      {a && mode === 'acquisition' && <AcquisitionModal clientId={clientId} assetId={a.id} accounts={akun.data} onClose={() => setMode(null)} />}
      {a && mode === 'adjustment' && <AdjustmentModal clientId={clientId} assetId={a.id} minDate={a.acquisition_date ?? undefined} accounts={akun.data} onClose={() => setMode(null)} />}
      <ReasonDialog open={!!balik} title={`Reverse ${balik?.journal_no ?? ''}`} withDate minDate={balik?.journal_date} defaultDate={todayIso()}
        subtitle="A reversing journal (RV-) is posted on the reversal date." onClose={() => setBalik(null)}
        onConfirm={async (reason, date) => {
          try {
            toast.success((await reverseJournal(clientId, balik!.id, reason, date)).message);
          } catch (e) {
            toast.error((e as Error).message);
            throw e;
          }
        }} />
    </Drawer>
  );
}

function AcquisitionModal({ clientId, assetId, accounts, onClose }: { clientId: string; assetId: string; accounts: CoaAccount[]; onClose: () => void }) {
  const [akun, setAkun] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const kirim = async () => {
    setBusy(true);
    try {
      toast.success((await postAcquisition(clientId, assetId, akun!)).message);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Post Acquisition Journal" subtitle="Dr asset account / Cr the account below, on the acquisition date (Manager level)."
      footer={<>
        <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
        <button type="button" onClick={kirim} disabled={busy || !akun} className={btnPrimary}>{busy && <Loader2 size={14} className="animate-spin" />} Post</button>
      </>}>
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">Skip this if the purchase is already recorded through Purchase, Cash &amp; Bank or Opening Balance.</p>
      <FormField label="Credit Account" required><AccountSelect accounts={accounts.filter(a => a.is_active)} value={akun} onChange={setAkun} /></FormField>
    </Modal>
  );
}

function AdjustmentModal({ clientId, assetId, minDate, accounts, onClose }: {
  clientId: string; assetId: string; minDate?: string; accounts: CoaAccount[]; onClose: () => void;
}) {
  const [target, setTarget] = useState<'cost' | 'accumulated_depreciation'>('cost');
  const [arah, setArah] = useState<1 | -1>(1);
  const [jumlah, setJumlah] = useState('');
  const [tanggal, setTanggal] = useState(todayIso());
  const [akun, setAkun] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [ket, setKet] = useState('');
  const [busy, setBusy] = useState(false);
  const kirim = async () => {
    setBusy(true);
    try {
      toast.success((await postAdjustment(clientId, assetId, {
        target, amount: arah * Number(jumlah), adjustment_date: tanggal, offset_coa_id: akun!, reference: ref.trim() || null, description: ket.trim(),
      })).message);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Asset Adjustment" subtitle="Correct the cost (e.g. capitalised improvement) or accumulated depreciation. Posted immediately (Manager level)."
      footer={<>
        <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
        <button type="button" onClick={kirim} disabled={busy || !akun || !(Number(jumlah) > 0) || ket.trim().length < 3} className={btnPrimary}>
          {busy && <Loader2 size={14} className="animate-spin" />} Post Adjustment
        </button>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Adjust">
          <select value={target} onChange={e => setTarget(e.target.value as typeof target)} className={inputCls}>
            <option value="cost">Cost</option><option value="accumulated_depreciation">Accumulated Depreciation</option>
          </select>
        </FormField>
        <FormField label="Direction">
          <select value={arah} onChange={e => setArah(Number(e.target.value) as 1 | -1)} className={inputCls}>
            <option value={1}>Increase</option><option value={-1}>Decrease</option>
          </select>
        </FormField>
        <FormField label="Amount (IDR)" required><input type="number" min={0} step="0.01" value={jumlah} onChange={e => setJumlah(e.target.value)} className={inputCls} /></FormField>
        <FormField label="Date" required><input type="date" value={tanggal} min={minDate} onChange={e => setTanggal(e.target.value)} className={inputCls} /></FormField>
      </div>
      <FormField label="Offset Account" required hint="e.g. Accounts Payable / Bank for improvements, expense or income for corrections">
        <AccountSelect accounts={accounts.filter(a => a.is_active)} value={akun} onChange={setAkun} />
      </FormField>
      <FormField label="Reference"><input value={ref} onChange={e => setRef(e.target.value)} className={inputCls} maxLength={100} placeholder="ADJ-0001" /></FormField>
      <FormField label="Description" required><textarea rows={2} value={ket} onChange={e => setKet(e.target.value)} className={inputCls} maxLength={1000} /></FormField>
    </Modal>
  );
}
