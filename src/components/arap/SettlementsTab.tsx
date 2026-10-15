'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, MoreHorizontal, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
  deleteSettlement, fmtDate, LEVEL_INPUT, LEVEL_POST, PAYMENT_METHOD_LABEL, roleLevel, rupiah, SETTLEMENT_STATUS_LABEL,
  SOURCE_LABEL, submitSettlement, type Settlement, type SettlementStatus, type SideConfig,
} from '@/lib/receivablesPayablesStore';
import {
  btnSmall, Card, EmptyRow, Menu, MenuItem, Pager, ReverseModal, SettlementBadge, SettlementDrawer, sortRows, SortTh, useSort,
} from './arapUi';

// Tab Collections / Payments (mode "all": semua status, aksi edit/submit/hapus/balik)
// dan tab Posted (mode "posted": posted + reversed beserta jurnalnya).
// Pelunasan yang dibuat di Cash & Bank (Bank Feed / input manual) ikut tampil
// tapi hanya bisa diubah dari Cash & Bank.

type Kunci = 'tx_number' | 'tx_date' | 'counterparty' | 'amount' | 'status';

export default function SettlementsTab({ cfg, clientId, mode, data, loading }: {
  cfg: SideConfig; clientId: string; mode: 'all' | 'posted'; data: Settlement[]; loading: boolean;
}) {
  const { user } = useAuth();
  const level = roleLevel(user?.role);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | SettlementStatus>('all');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [lihat, setLihat] = useState<Settlement | null>(null);
  const [balik, setBalik] = useState<Settlement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { sort, onSort } = useSort<Kunci>('tx_date');
  const formPath = `${cfg.basePath}/${cfg.side === 'ar' ? 'receipts' : 'payments'}/new`;

  const dasar = useMemo(() => (mode === 'posted' ? data.filter(s => s.status === 'posted' || s.status === 'reversed') : data), [data, mode]);
  const pilihanStatus: SettlementStatus[] = mode === 'posted' ? ['posted', 'reversed'] : ['draft', 'approved', 'posted', 'reversed'];
  const tersaring = useMemo(() => {
    const kata = q.trim().toLowerCase();
    const r = dasar.filter(s => (status === 'all' || s.status === status)
      && (!kata || s.tx_number.toLowerCase().includes(kata) || (s.counterparty ?? '').toLowerCase().includes(kata)
        || (s.reference ?? '').toLowerCase().includes(kata) || s.lines.some(l => (l.invoice_no ?? '').toLowerCase().includes(kata))));
    return sortRows(r, s => s[sort.key] as string | number, sort.dir);
  }, [dasar, q, status, sort]);
  useEffect(() => setPage(0), [q, status, size]);
  useEffect(() => {
    if (lihat) setLihat(data.find(s => s.id === lihat.id) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const halaman = tersaring.slice(page * size, (page + 1) * size);
  const total = tersaring.filter(s => s.status !== 'reversed').reduce((n, s) => n + s.amount, 0);

  const aksi = async (s: Settlement, jenis: 'submit' | 'delete') => {
    setBusy(s.id);
    try {
      const r = jenis === 'submit' ? await submitSettlement(cfg.side, clientId, s.id) : await deleteSettlement(cfg.side, clientId, s.id);
      toast.success(r.message);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const tombolDrawer = (s: Settlement) => (
    <>
      {s.editable && level >= LEVEL_INPUT && <Link href={`${formPath}?id=${s.id}`} className={btnSmall}>Edit</Link>}
      {(s.status === 'draft' || (s.status === 'approved' && level >= LEVEL_POST)) && level >= LEVEL_INPUT && (
        <button type="button" className={btnSmall} disabled={busy === s.id} onClick={() => aksi(s, 'submit')}>
          {level >= LEVEL_POST ? 'Post' : 'Submit'}
        </button>
      )}
      {s.status === 'posted' && level >= LEVEL_POST && (
        <button type="button" className={`${btnSmall} text-rose-600`} onClick={() => { setLihat(null); setBalik(s); }}>Reverse</button>
      )}
    </>
  );

  return (
    <Card
      title={mode === 'posted' ? `Posted ${cfg.settle}s` : `${cfg.settlementsTab}`}
      subtitle={mode === 'posted'
        ? `${cfg.settle}s posted to the general ledger (Cash & Bank journal) and their reversals.`
        : `${cfg.settle}s recorded against ${cfg.docs.toLowerCase()} — from this menu or matched in Cash & Bank. Draft and approved ${cfg.settle.toLowerCase()}s do not reduce the balance until posted.`}
      action={<>
        <label className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 sm:w-64">
          <Search size={14} className="text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search number, ${cfg.party.toLowerCase()}, ${cfg.doc.toLowerCase()}...`}
            className="w-full bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none" />
        </label>
        <select value={status} onChange={e => setStatus(e.target.value as 'all' | SettlementStatus)} className="rounded-xl border border-border bg-card px-3 py-2 text-sm">
          <option value="all">All statuses</option>
          {pilihanStatus.map(s => <option key={s} value={s}>{SETTLEMENT_STATUS_LABEL[s]}</option>)}
        </select>
        {mode === 'all' && <Link href={formPath} className={`${btnSmall} border-transparent bg-[#0F7D4E] py-2 text-white hover:bg-[#0c6a42]`}>Record {cfg.settle}</Link>}
      </>}
    >
      <div className="overflow-x-auto px-5">
        <table className="w-full min-w-[1040px] text-sm">
          <thead>
            <tr className="border-y border-border bg-slate-50 text-xs text-slate-600">
              <SortTh label="Number" k="tx_number" sort={sort} onSort={onSort} />
              <SortTh label="Date" k="tx_date" sort={sort} onSort={onSort} />
              <SortTh label={cfg.party} k="counterparty" sort={sort} onSort={onSort} />
              <th className="px-3 py-2.5 text-left font-medium">{cfg.docs}</th>
              <th className="px-3 py-2.5 text-left font-medium">Method · Account</th>
              <SortTh label="Amount" k="amount" sort={sort} onSort={onSort} align="right" />
              <SortTh label="Status" k="status" sort={sort} onSort={onSort} />
              <th className="px-3 py-2.5 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading || halaman.length === 0 ? (
              <EmptyRow cols={8} loading={loading} text={dasar.length ? 'No matching items.' : `No ${cfg.settle.toLowerCase()}s recorded yet.`} />
            ) : halaman.map(s => {
              const docs = s.lines.filter(l => l.invoice_no).map(l => l.invoice_no!);
              return (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2.5">
                    <button type="button" onClick={() => setLihat(s)} className="font-medium text-[#0F7D4E] hover:underline">{s.tx_number}</button>
                    {s.source !== cfg.side && <span className="block text-[10px] text-muted-foreground">{SOURCE_LABEL[s.source]}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(s.tx_date)}</td>
                  <td className="max-w-[200px] truncate px-3 py-2.5 text-foreground" title={s.counterparty ?? ''}>{s.counterparty || '—'}</td>
                  <td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-muted-foreground" title={docs.join(', ')}>
                    {docs.length ? docs.join(', ') : (s.unapplied ? 'Unapplied' : '—')}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {s.payment_method ? PAYMENT_METHOD_LABEL[s.payment_method] : '—'}
                    <span className="block">{s.bank_account_code} · {s.bank_account_name}</span>
                  </td>
                  <td className={`px-3 py-2.5 text-right font-semibold ${s.status === 'reversed' ? 'text-muted-foreground line-through' : ''}`}>{rupiah(s.amount)}</td>
                  <td className="px-3 py-2.5">
                    <SettlementBadge status={s.status} />
                    {s.status === 'reversed' && <span className="block text-[10px] text-muted-foreground">on {fmtDate(s.reversal_date)}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setLihat(s)} className={btnSmall}>View</button>
                      {busy === s.id ? <Loader2 size={14} className="animate-spin text-muted-foreground" /> : (
                        <Menu width="w-48" button={() => <button type="button" className={`${btnSmall} px-2`} aria-label="More actions"><MoreHorizontal size={14} /></button>}>
                          {close => (
                            <>
                              <MenuItem disabled={!s.editable || level < LEVEL_INPUT} href={`${formPath}?id=${s.id}`} onClick={close}>Edit</MenuItem>
                              <MenuItem disabled={!(s.status === 'draft' || (s.status === 'approved' && level >= LEVEL_POST)) || level < LEVEL_INPUT}
                                onClick={() => { close(); aksi(s, 'submit'); }}>{level >= LEVEL_POST ? 'Post to ledger' : 'Submit for posting'}</MenuItem>
                              <MenuItem disabled={s.status !== 'posted' || level < LEVEL_POST} onClick={() => { close(); setBalik(s); }}>Reverse</MenuItem>
                              <MenuItem danger disabled={!s.editable || level < LEVEL_INPUT} onClick={() => { close(); aksi(s, 'delete'); }}>Delete</MenuItem>
                              {s.source !== cfg.side && <MenuItem href="/transactions/bank-cash/posted" onClick={close}>Open in Cash & Bank</MenuItem>}
                            </>
                          )}
                        </Menu>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {tersaring.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-slate-50 text-sm font-semibold">
                <td className="px-3 py-2.5" colSpan={5}>Total excl. reversed ({tersaring.length})</td>
                <td className="px-3 py-2.5 text-right">{rupiah(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <Pager page={page} pageSize={size} total={tersaring.length} onPage={setPage} onPageSize={setSize} sizes={[10, 25, 50, 100]} />
      <SettlementDrawer cfg={cfg} s={lihat} onClose={() => setLihat(null)} actions={lihat ? tombolDrawer(lihat) : undefined} />
      <ReverseModal cfg={cfg} clientId={clientId} s={balik} onClose={() => setBalik(null)} />
    </Card>
  );
}
