'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowsUpDownIcon,
  ArrowDownTrayIcon,
  CheckBadgeIcon,
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';
import { BookOpen, ArrowDownCircle, ArrowUpCircle, Scale, Search } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { formatIDR } from '../lib/formatMoney';
import CashBankTabs from '../components/CashBankTabs';
import {
  PostedKpiTile, SourcePanel, StatusPill, TablePagination, FilterSelect, ModalShell,
  ACTION_BTN_SECONDARY, CHECKBOX_CLS, FIELD_CLS, FIELD_LABEL_CLS,
  PANEL_ICON_CHIP, TD_CLS, TH_CLS, TR_CLS,
} from '../components/sourceUi';
import { usePostedJurnalRekon, type CashBankTxReal } from '../lib/useBankCashRekon';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { reverseBcTransaction } from '@/lib/bankCashStore';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

// Tab Posted (Cash & Bank) = transaksi kas & bank yang sudah diposting ke buku besar
// (usePostedJurnalRekon -> GET /api/v1/transactions/bank-cash/transactions?status=posted,reversed).
//
// Balik transaksi (Manager ke atas): POST /transactions/{id}/reverse. Jurnal asal tetap di buku
// besar pada tanggalnya, jurnal pembalik RV-<no> dibuat di tanggal pembalik (sisi debit/kredit
// ditukar), pelunasan invoice dibatalkan dan mutasi Bank Feed-nya kembali "belum cocok" supaya bisa
// dicocokkan ulang. Transaksi yang dibalik disembunyikan dari daftar & ringkasan, bisa ditampilkan
// lewat kotak centang di bawah filter.

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type SortField = 'tx_date' | 'tx_no' | 'counterparty' | 'amount';
type SortDir = 'asc' | 'desc';

const periodeDari = (iso: string) => (iso || '').slice(0, 7); // YYYY-MM
const labelPeriode = (p: string) => {
  const [y, m] = p.split('-');
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${BULAN[idx]} ${y}` : p;
};
const formatTanggal = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
};

const formatWaktu = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const jam = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${String(d.getDate()).padStart(2, '0')} ${BULAN[d.getMonth()]} ${d.getFullYear()} ${jam}`;
};

// Harus sama dengan LEVEL_POST di backend (transactions/bank_cash_v1.py). Backend tetap yang menentukan;
// ini hanya menyembunyikan tombol dari user yang pasti ditolak (403).
const LEVEL_BALIK_JURNAL = 4; // Manager (tahap_4) ke atas
const levelDariRole = (role?: string | null) => {
  if (role === 'super_admin') return 999;
  const m = /^tahap_(\d+)$/.exec(role ?? '');
  return m ? Number(m[1]) : 0;
};
const hariIniLokal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function eksporCsv(rows: CashBankTxReal[]) {
  const header = [
    'Journal No.', 'Journal Date', 'Direction', 'Counterparty', 'Linked Invoice',
    'Cash/Bank Account', 'Counter Account', 'Amount',
    'Posted By', 'Posted At', 'Bank Line Ref', 'Status', 'Reversal Journal', 'Reversal Reason',
  ];
  const lines = rows.map((r) => [
    r.tx_no,
    r.tx_date,
    r.direction,
    r.counterparty,
    r.linkedInvoice?.no ?? '',
    r.bank_account,
    r.linkedInvoice?.counterpartyAccount ?? '',
    r.amount,
    r.postedBy ?? '',
    r.postedAt ?? '',
    r.mutationRef ?? '',
    r.reversal ? 'Reversed' : 'Posted',
    r.reversal?.journalNo ?? '',
    r.reversal?.reason ?? '',
  ]);
  const csv = [header, ...lines].map((l) => l.map(csvCell).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cash-bank-posted-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const KOLOM: { label: string; field?: SortField; align?: 'right' }[] = [
  { label: 'Journal No.', field: 'tx_no' },
  { label: 'Journal Date', field: 'tx_date' },
  { label: 'Direction' },
  { label: 'Counterparty', field: 'counterparty' },
  { label: 'Linked Invoice' },
  { label: 'Cash/Bank Account' },
  { label: 'Amount', field: 'amount', align: 'right' },
  { label: 'Posted By' },
  { label: 'Posted At' },
  { label: 'Status' },
  { label: 'Detail' },
];

export default function CashBankPostedPage() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { activeClientId } = useActiveClient();
  const { user } = useAuth();
  const { txs, loading, error, refresh } = usePostedJurnalRekon();
  const bisaBalik = levelDariRole(user?.role) >= LEVEL_BALIK_JURNAL;

  // Jurnal asal yang sudah dibalik tetap POSTED di backend, jadi dipisah di sini: angka ringkasan
  // hanya menghitung jurnal yang masih berlaku.
  const semuaPosted = useMemo(() => txs.filter((x) => x.posting_status === 'Posted'), [txs]);
  const aktif = useMemo(() => semuaPosted.filter((x) => !x.reversal), [semuaPosted]);
  const jumlahDibalik = semuaPosted.length - aktif.length;
  const [tampilDibalik, setTampilDibalik] = useState(false);
  const posted = tampilDibalik ? semuaPosted : aktif;

  const [search, setSearch] = useState('');
  const [arahFilter, setArahFilter] = useState<'all' | 'Cash Payment' | 'Cash Receipt'>('all');
  const [periodeFilter, setPeriodeFilter] = useState('all');
  const [bankFilter, setBankFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('tx_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Dialog Balik Jurnal
  const [balikTarget, setBalikTarget] = useState<CashBankTxReal | null>(null);
  const [balikAlasan, setBalikAlasan] = useState('');
  const [balikTanggal, setBalikTanggal] = useState('');
  const [membalik, setMembalik] = useState(false);

  const bukaDialogBalik = (row: CashBankTxReal) => {
    const hariIni = hariIniLokal();
    setBalikTarget(row);
    setBalikAlasan('');
    setBalikTanggal(hariIni < row.tx_date ? row.tx_date : hariIni);
  };
  const tutupDialogBalik = () => {
    if (!membalik) setBalikTarget(null);
  };
  const konfirmasiBalik = async () => {
    if (!balikTarget || membalik) return;
    if (!activeClientId) {
      toast.error('No active company — select one in the top bar first.');
      return;
    }
    const alasan = balikAlasan.trim();
    if (alasan.length < 5) {
      toast.error('A reversal reason is required (at least 5 characters).');
      return;
    }
    setMembalik(true);
    try {
      await reverseBcTransaction(String(activeClientId), balikTarget.id, alasan, balikTanggal || null);
      toast.success('Journal reversed', {
        description: `${balikTarget.tx_no} → RV-${balikTarget.tx_no}`,
      });
      setBalikTarget(null);
      setExpandedId(null);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to reverse the journal.');
    } finally {
      setMembalik(false);
    }
  };

  const periodeList = useMemo(
    () => Array.from(new Set(posted.map((x) => periodeDari(x.tx_date)).filter(Boolean))).sort().reverse(),
    [posted],
  );
  const bankList = useMemo(
    () => Array.from(new Set(posted.map((x) => x.bank_account).filter(Boolean))).sort(),
    [posted],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const data = posted.filter((x) => {
      if (arahFilter !== 'all' && x.direction !== arahFilter) return false;
      if (periodeFilter !== 'all' && periodeDari(x.tx_date) !== periodeFilter) return false;
      if (bankFilter !== 'all' && x.bank_account !== bankFilter) return false;
      if (!q) return true;
      return [x.tx_no, x.counterparty, x.linkedInvoice?.no ?? '', x.bank_account].some((v) =>
        v.toLowerCase().includes(q),
      );
    });
    data.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [posted, search, arahFilter, periodeFilter, bankFilter, sortField, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, arahFilter, periodeFilter, bankFilter, sortField, sortDir, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  // Angka KPI hanya menghitung jurnal yang masih berlaku (aktif). Persentase = porsi untuk bar proporsi
  // di kartu (desain sama dengan KPI Sales Posted).
  const ringkasan = useMemo(() => {
    const receipts = aktif.filter((x) => x.direction === 'Cash Receipt');
    const payments = aktif.filter((x) => x.direction === 'Cash Payment');
    const cashIn = receipts.reduce((n, x) => n + x.amount, 0);
    const cashOut = payments.reduce((n, x) => n + x.amount, 0);
    const periode = new Set(aktif.map((x) => periodeDari(x.tx_date)).filter(Boolean)).size;
    const arus = cashIn + cashOut;
    const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
    return {
      total: aktif.length,
      cashIn,
      cashOut,
      net: cashIn - cashOut,
      periode,
      jumlahIn: receipts.length,
      jumlahOut: payments.length,
      pctAktif: pctOf(aktif.length, semuaPosted.length),
      pctIn: pctOf(cashIn, arus),
      pctOut: pctOf(cashOut, arus),
      pctNet: pctOf(Math.max(cashIn - cashOut, 0), cashIn),
    };
  }, [aktif, semuaPosted]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const adaFilter = search !== '' || arahFilter !== 'all' || periodeFilter !== 'all' || bankFilter !== 'all';

  return (
    <div className="space-y-5">
      <CashBankTabs />

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          <span>{error}</span>
          <button onClick={refresh} className="font-semibold underline hover:no-underline shrink-0">
            Retry
          </button>
        </div>
      )}

      {!activeClientId && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          No active company — select one via Switch Company in the top bar.
        </div>
      )}

      {/* KPI Cards -- desain sama dengan KPI Sales Posted (PostedKpiTile) */}
      <div className="!mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <PostedKpiTile
          label="Posted Journals"
          value={ringkasan.total.toLocaleString('id-ID')}
          sub={`${ringkasan.periode} accounting periods`}
          pct={ringkasan.pctAktif}
          pctLabel="of all posted journals active"
          icon={BookOpen}
        />
        <PostedKpiTile
          label="Total Cash In"
          value={formatIDR(ringkasan.cashIn)}
          sub={`${ringkasan.jumlahIn.toLocaleString('id-ID')} receipts`}
          pct={ringkasan.pctIn}
          pctLabel="of total cash movement"
          icon={ArrowDownCircle}
        />
        <PostedKpiTile
          label="Total Cash Out"
          value={formatIDR(ringkasan.cashOut)}
          sub={`${ringkasan.jumlahOut.toLocaleString('id-ID')} payments`}
          pct={ringkasan.pctOut}
          pctLabel="of total cash movement"
          icon={ArrowUpCircle}
        />
        <PostedKpiTile
          label="Net Cash Flow"
          value={formatIDR(ringkasan.net)}
          sub={ringkasan.net >= 0 ? 'Surplus' : 'Deficit'}
          pct={ringkasan.pctNet}
          pctLabel="of cash in retained"
          icon={Scale}
        />
      </div>

      {/* Filter -- desain sama dengan filter Sales Posted (dropdown netral, tanpa kartu) */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={arahFilter}
          onChange={(v) => setArahFilter(v as typeof arahFilter)}
          options={[
            { value: 'all', label: 'All Directions' },
            { value: 'Cash Payment', label: 'Cash Payment' },
            { value: 'Cash Receipt', label: 'Cash Receipt' },
          ]}
        />
        <FilterSelect
          value={periodeFilter}
          onChange={setPeriodeFilter}
          options={[{ value: 'all', label: 'All Periods' }, ...periodeList.map((p) => ({ value: p, label: labelPeriode(p) }))]}
        />
        <FilterSelect
          value={bankFilter}
          onChange={setBankFilter}
          className="max-w-[240px]"
          options={[{ value: 'all', label: 'All Accounts' }, ...bankList.map((b) => ({ value: b, label: b }))]}
        />
        {adaFilter && (
          <button
            onClick={() => { setSearch(''); setArahFilter('all'); setPeriodeFilter('all'); setBankFilter('all'); }}
            className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:underline"
          >
            Reset
          </button>
        )}
        {jumlahDibalik > 0 && (
          <label className="ml-auto flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-neutral-600">
            <input type="checkbox" className={CHECKBOX_CLS} checked={tampilDibalik} onChange={(e) => setTampilDibalik(e.target.checked)} />
            Show reversed ({jumlahDibalik})
          </label>
        )}
      </div>

      {/* Tabel */}
      <SourcePanel
        title="Posted Journal List"
        subtitle={`${filtered.length.toLocaleString('id-ID')} of ${posted.length.toLocaleString('id-ID')} ${tampilDibalik ? 'journals' : 'posted journals'}`}
        leading={<span className={PANEL_ICON_CHIP}><BookOpen size={17} /></span>}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative w-full sm:w-[320px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search journal no., counterparty, invoice, or account..."
                className="w-full rounded-lg border border-neutral-300 bg-white py-1.5 pl-9 pr-3 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
              />
            </div>
            <button
              onClick={() => eksporCsv(filtered)}
              disabled={filtered.length === 0}
              className={ACTION_BTN_SECONDARY}
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        }
        flush
      >
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[1200px] select-text border-separate border-spacing-0">
            <thead>
              <tr className="bg-neutral-300">
                {KOLOM.map((col) => (
                  <th
                    key={col.label}
                    onClick={col.field ? () => handleSort(col.field!) : undefined}
                    className={`${TH_CLS} select-none ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.field ? 'cursor-pointer hover:text-neutral-700' : ''}`}
                  >
                    <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}>
                      {col.label}
                      {col.field && <ArrowsUpDownIcon className="w-3 h-3 opacity-50" />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={KOLOM.length} className="px-2 py-10 text-center text-xs text-neutral-500">
                    {loading
                      ? 'Loading data...'
                      : adaFilter
                      ? 'No journals match the filter.'
                      : 'No posted journals yet. Journals appear here once posted from the Journal Preview tab.'}
                  </td>
                </tr>
              ) : (
                paged.map((row) => {
                  const terbuka = expandedId === row.id;
                  const isReceipt = row.direction === 'Cash Receipt';
                  const baris = row.realLines ?? [];
                  const totalDebit = baris.reduce((n, l) => n + l.debit, 0);
                  const totalKredit = baris.reduce((n, l) => n + l.credit, 0);
                  const seimbang = Math.abs(totalDebit - totalKredit) < 0.5;
                  return (
                    <React.Fragment key={row.id}>
                      <tr className={`${TR_CLS} ${row.reversal ? 'opacity-60' : ''}`}>
                        <td className={`${TD_CLS} font-medium text-blue-700`}>{row.tx_no}</td>
                        <td className={`${TD_CLS} text-neutral-900`}>{formatTanggal(row.tx_date)}</td>
                        <td className={TD_CLS}>
                          <StatusPill tone={isReceipt ? 'emerald' : 'red'} label={row.direction} />
                        </td>
                        <td className={`${TD_CLS} max-w-[200px] truncate font-medium text-neutral-900`}>{row.counterparty}</td>
                        <td className={`${TD_CLS} max-w-[180px] truncate tabular-nums text-neutral-900`}>{row.linkedInvoice?.no ?? '—'}</td>
                        <td className={`${TD_CLS} max-w-[200px] truncate text-neutral-600`}>{row.bank_account || '—'}</td>
                        <td className={`${TD_CLS} text-right font-semibold tabular-nums text-neutral-900`}>{formatIDR(row.amount)}</td>
                        <td className={`${TD_CLS} text-neutral-900`}>{row.postedBy || '—'}</td>
                        <td className={`${TD_CLS} text-neutral-600`}>{formatWaktu(row.postedAt)}</td>
                        <td className={TD_CLS}>
                          <StatusPill tone={row.reversal ? 'amber' : 'emerald'} label={row.reversal ? 'Reversed' : 'Posted'} />
                        </td>
                        <td className={TD_CLS}>
                          <button
                            onClick={() => setExpandedId(terbuka ? null : row.id)}
                            className="flex items-center gap-0.5 text-xs font-semibold text-neutral-800 hover:text-neutral-900 hover:underline"
                          >
                            {terbuka ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
                            {terbuka ? 'Close' : 'Detail'}
                          </button>
                        </td>
                      </tr>

                      {terbuka && (
                        <tr className="[&>td]:shadow-[inset_0_-1px_0_#b4b4b4]">
                          <td colSpan={KOLOM.length} className="bg-neutral-100 px-4 py-0">
                            <div className="py-4 space-y-3">
                              {/* Info jurnal & invoice */}
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {[
                                  { label: 'Type', value: row.transaction_type },
                                  { label: 'Invoice Type', value: row.linkedInvoice?.type ?? 'No invoice' },
                                  { label: 'Counter Account', value: row.linkedInvoice?.counterpartyAccount ?? ((row.realLines || []).slice(1).map((l) => `${kodeAkun(l.code)} - ${l.name}`).join(', ') || '—') },
                                ].map((item) => (
                                  <div key={item.label} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 shadow-sm">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">{item.label}</p>
                                    <p className="text-xs font-semibold text-neutral-900 mt-0.5 break-words">{item.value}</p>
                                  </div>
                                ))}
                              </div>

                              {/* Info mutasi bank asal */}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {[
                                  { label: 'Source', value: row.mutationRef ? 'Source Data' : 'Manual entry', mono: false },
                                  { label: 'Bank Line Description', value: row.mutationDescription || '—', mono: false },
                                  { label: 'Bank Line Ref', value: row.mutationRef || '—', mono: true },
                                ].map((item) => (
                                  <div key={item.label} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 shadow-sm">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">{item.label}</p>
                                    <p className={`text-xs font-semibold text-neutral-900 mt-0.5 break-words ${item.mono ? 'tabular-nums' : ''}`}>{item.value}</p>
                                  </div>
                                ))}
                              </div>

                              {/* Baris jurnal */}
                              <div className="overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm">
                                <div className="border-b border-neutral-300 bg-neutral-50 px-3 py-2">
                                  <p className="text-xs font-semibold text-neutral-900">Journal Lines</p>
                                </div>
                                {baris.length === 0 ? (
                                  <p className="px-3 py-4 text-xs text-neutral-500">Journal lines not available.</p>
                                ) : (
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-neutral-300 bg-neutral-100">
                                        <th className="px-3 py-2 text-left font-bold text-neutral-700 w-10">No</th>
                                        <th className="px-3 py-2 text-left font-bold text-neutral-700">Account</th>
                                        <th className="px-3 py-2 text-right font-bold text-neutral-700">Debit</th>
                                        <th className="px-3 py-2 text-right font-bold text-neutral-700">Credit</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-neutral-200">
                                      {baris.map((l) => (
                                        <tr key={l.no}>
                                          <td className="px-3 py-2 text-neutral-500">{l.no}</td>
                                          <td className="px-3 py-2 text-neutral-900">
                                            <span className="tabular-nums">{kodeAkun(l.code)}</span> · {l.name}
                                          </td>
                                          <td className="px-3 py-2 text-right tabular-nums">{l.debit > 0 ? formatIDR(l.debit) : '—'}</td>
                                          <td className="px-3 py-2 text-right tabular-nums">{l.credit > 0 ? formatIDR(l.credit) : '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className={`border-t ${seimbang ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300'}`}>
                                        <td colSpan={2} className={`px-3 py-2 text-right font-bold ${seimbang ? 'text-emerald-800' : 'text-red-800'}`}>
                                          Total {seimbang ? '· Balanced' : '· Not balanced'}
                                        </td>
                                        <td className={`px-3 py-2 text-right font-bold tabular-nums ${seimbang ? 'text-emerald-800' : 'text-red-800'}`}>
                                          {formatIDR(totalDebit)}
                                        </td>
                                        <td className={`px-3 py-2 text-right font-bold tabular-nums ${seimbang ? 'text-emerald-800' : 'text-red-800'}`}>
                                          {formatIDR(totalKredit)}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                )}
                              </div>

                              {row.reversal ? (
                                /* Sudah dibalik */
                                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5">
                                  <ArrowUturnLeftIcon className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                  <div className="text-xs text-amber-800 space-y-0.5">
                                    <p className="font-semibold">
                                      This journal was reversed by <span className="tabular-nums">{row.reversal.journalNo}</span>
                                      {row.reversal.date ? ` (dated ${formatTanggal(row.reversal.date)})` : ''}.
                                    </p>
                                    <p>Reversed by {row.reversal.by || '—'} on {formatWaktu(row.reversal.at)}.</p>
                                    {row.reversal.reason && <p>Reason: {row.reversal.reason}</p>}
                                    <p>
                                      The payment was cancelled and the invoice outstanding has been restored. The bank line can be
                                      matched again in the Reconciliation tab.
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {/* Indikator posted */}
                                  <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5">
                                    <CheckBadgeIcon className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                                    <p className="text-xs text-emerald-800 font-medium">
                                      This journal has been posted to the ledger
                                      {row.linkedInvoice ? ` and the outstanding of invoice ${row.linkedInvoice.no} has been updated.` : '.'}
                                    </p>
                                  </div>
                                  {bisaBalik ? (
                                    <div className="flex justify-end">
                                      <button
                                        onClick={() => bukaDialogBalik(row)}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 shadow-sm transition-colors hover:border-red-600 hover:bg-red-50"
                                      >
                                        <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
                                        Reverse Journal
                                      </button>
                                    </div>
                                  ) : (
                                    <p className="text-[11px] text-neutral-500 text-right">
                                      Only Manager or above can reverse a posted journal.
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          total={filtered.length}
          page={pageSafe}
          pageSize={pageSize}
          onPage={(p) => setPage(Math.min(Math.max(1, p), totalPages))}
          onPageSize={(n) => { setPageSize(n); setPage(1); }}
          unit="journals"
        />
      </SourcePanel>

      {/* Dialog Balik Jurnal -- cangkang modal sama dengan modal lain di Cash & Bank */}
      {balikTarget && (
        <ModalShell
          title="Reverse Journal"
          subtitle={<span className="tabular-nums">{balikTarget.tx_no} · {formatIDR(balikTarget.amount)}</span>}
          icon={<ArrowUturnLeftIcon className="w-[17px] h-[17px]" />}
          onClose={tutupDialogBalik}
          closeDisabled={membalik}
          footer={
            <div className="ml-auto flex items-center gap-2">
              <button onClick={tutupDialogBalik} disabled={membalik} className={ACTION_BTN_SECONDARY}>
                Cancel
              </button>
              <button
                onClick={konfirmasiBalik}
                disabled={membalik || balikAlasan.trim().length < 5}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-700 bg-red-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {membalik ? 'Reversing...' : 'Reverse Journal'}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <p className="font-semibold">What will happen:</p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>A reversal journal (debit and credit swapped) is created and posted immediately. The original journal is not changed or deleted.</li>
                {balikTarget.linkedInvoice ? (
                  <li>
                    The payment to invoice {balikTarget.linkedInvoice.no} is cancelled, so the invoice outstanding goes back to
                    what it was before this payment.
                  </li>
                ) : (
                  <li>This journal has no invoice, so no Purchase/Sales outstanding changes.</li>
                )}
                {balikTarget.mutationRef && <li>Its Source Data line returns to Unmatched and can be matched again in the Reconciliation tab.</li>}
              </ul>
            </div>

            <div>
              <label htmlFor="balik-alasan" className={FIELD_LABEL_CLS}>
                Reversal reason <span className="text-red-600">*</span>
              </label>
              <textarea
                id="balik-alasan"
                value={balikAlasan}
                onChange={(e) => setBalikAlasan(e.target.value)}
                maxLength={300}
                rows={3}
                disabled={membalik}
                placeholder="E.g. matched to the wrong invoice, should be another one"
                className={FIELD_CLS}
              />
              <p className="mt-1 text-[11px] font-medium text-neutral-500">At least 5 characters. The reason is stored on the reversal journal.</p>
            </div>

            <div>
              <label htmlFor="balik-tanggal" className={FIELD_LABEL_CLS}>
                Reversal journal date
              </label>
              <input
                id="balik-tanggal"
                type="date"
                value={balikTanggal}
                min={balikTarget.tx_date}
                onChange={(e) => setBalikTanggal(e.target.value)}
                disabled={membalik}
                className={`${FIELD_CLS} sm:w-auto`}
              />
              <p className="mt-1 text-[11px] font-medium text-neutral-500">
                Cannot be earlier than the original journal date ({formatTanggal(balikTarget.tx_date)}).
              </p>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}