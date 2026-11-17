'use client';

// Tab Draft: aset yang disimpan dengan checkbox "Draft" di form Add/Edit Asset
// (asset_fixed_assets.is_draft = true). Belum masuk register / penyusutan / laporan
// sampai di-Register (is_draft -> false).

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CircleCheck, FilePen, MoreHorizontal, Search } from 'lucide-react';
import { fmtDate, rupiah } from '@/lib/receivablesPayablesStore';
import {
  assetToInput, deleteAsset, fetchDrafts, METHOD_LABEL, saveAsset, useFaData, type FixedAsset, type Register,
} from '@/lib/fixedAssetsStore';
import { EmptyRow, inputCls, Menu, MenuItem, NumberPager, SortTh, sortRows, useSort } from '@/components/arap/arapUi';
import { tdCls } from '@/components/shared/moduleUi';
import type { FaActions } from './FixedAssetsWorkspace';

type SortKey = 'asset_code' | 'name' | 'acquisition_date' | 'original_cost' | 'edited_at';

export default function DraftTab({ clientId, actions }: { clientId: string; actions: FaActions }) {
  const reg = useFaData<Register | null>(`draft:${clientId}`, s => fetchDrafts(clientId, s), null);
  const [cari, setCari] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { sort, onSort } = useSort<SortKey>('asset_code', 'asc');
  const aset = useMemo(() => reg.data?.assets ?? [], [reg.data]);

  const baris = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const f = aset.filter(a => !q || [a.asset_code, a.name, a.category, a.custodian, a.serial_number, a.description]
      .some(x => (x || '').toLowerCase().includes(q)));
    return sortRows(f, a => (sort.key === 'edited_at' ? (a.edited_at ?? a.created_at) : a[sort.key]) ?? null, sort.dir);
  }, [aset, cari, sort]);
  const tampil = baris.slice(page * pageSize, (page + 1) * pageSize);

  const register = async (a: FixedAsset) => {
    if (!window.confirm(`Register ${a.asset_code} - ${a.name}? It will move to the Asset Register and be included in depreciation and reports.`)) return;
    setBusyId(a.id);
    try {
      await saveAsset(clientId, assetToInput(a, false), a.id);
      toast.success(`${a.asset_code} registered.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const hapus = async (a: FixedAsset) => {
    if (!window.confirm(`Delete draft ${a.asset_code} - ${a.name}?`)) return;
    try {
      toast.success((await deleteAsset(clientId, a.id)).message);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      {reg.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{reg.error}</div>}
      <section className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 px-5 pb-3 pt-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><FilePen size={20} /></span>
            <div>
              <h2 className="text-lg font-bold text-foreground">Draft Assets</h2>
              <p className="text-xs text-muted-foreground">Assets saved as draft. They are excluded from the register, depreciation and reports until registered.</p>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>{aset.length} draft{aset.length === 1 ? '' : 's'}</div>
            <div className="text-sm font-semibold text-foreground">{rupiah(aset.reduce((n, a) => n + a.original_cost, 0))}</div>
          </div>
        </div>
        <div className="px-5 pb-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={cari} onChange={e => { setCari(e.target.value); setPage(0); }} placeholder="Search drafts by code, name, category..." className={`${inputCls} pl-9`} />
          </div>
        </div>
        <div className="overflow-x-auto px-2">
          <table className="w-full min-w-[1000px] text-sm">
            <thead><tr className="bg-slate-50 text-xs text-muted-foreground">
              <SortTh label="Asset Code" k="asset_code" sort={sort} onSort={onSort} />
              <SortTh label="Asset Name" k="name" sort={sort} onSort={onSort} />
              <th className="px-3 py-2.5 text-left font-medium">Category</th>
              <SortTh label="Acquisition Date" k="acquisition_date" sort={sort} onSort={onSort} />
              <SortTh label="Cost" k="original_cost" sort={sort} onSort={onSort} align="right" />
              <th className="px-3 py-2.5 text-left font-medium">Method</th>
              <th className="px-3 py-2.5 text-left font-medium">Location</th>
              <th className="px-3 py-2.5 text-left font-medium">Created By</th>
              <SortTh label="Last Updated" k="edited_at" sort={sort} onSort={onSort} />
              <th className="w-10" />
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(reg.loading && !reg.data) || !tampil.length ? (
                <EmptyRow cols={10} loading={reg.loading && !reg.data}
                  text={aset.length ? 'No drafts match the search.' : 'No draft assets. Tick "Draft" in the Add Asset form to save one here.'} />
              ) : tampil.map(a => (
                <tr key={a.id} className="cursor-pointer hover:bg-slate-50/60" onClick={() => actions.editAsset(a)}>
                  <td className={`${tdCls} font-medium`}>{a.asset_code}</td>
                  <td className={tdCls}>{a.name}</td>
                  <td className={tdCls}>{a.category ?? '—'}</td>
                  <td className={tdCls}>{fmtDate(a.acquisition_date)}</td>
                  <td className={`${tdCls} text-right`}>{rupiah(a.original_cost)}</td>
                  <td className={tdCls}>{a.depreciation_method ? METHOD_LABEL[a.depreciation_method] : '—'}</td>
                  <td className={tdCls}>{a.location ?? '—'}</td>
                  <td className={tdCls}>{a.created_by_name ?? '—'}</td>
                  <td className={tdCls}>{fmtDate(a.edited_at ?? a.created_at)}</td>
                  <td className={tdCls} onClick={e => e.stopPropagation()}>
                    <Menu width="w-44" button={() => <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-slate-100" aria-label="Actions"><MoreHorizontal size={16} /></button>}>
                      {close => <>
                        <MenuItem onClick={() => { close(); actions.editAsset(a); }}>Edit</MenuItem>
                        <MenuItem onClick={() => { close(); register(a); }} disabled={busyId === a.id}><CircleCheck size={14} /> Register</MenuItem>
                        <MenuItem danger onClick={() => { close(); hapus(a); }}>Delete</MenuItem>
                      </>}
                    </Menu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <NumberPager page={page} pageSize={pageSize} total={baris.length} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(0); }} noun="drafts" />
      </section>
    </div>
  );
}
