'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowsUpDownIcon,
  ArrowDownTrayIcon,
  CheckBadgeIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import KpiCard from '@/components/shared/KpiCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { useActiveClient } from '@/lib/activeClient';
import { formatIDR } from '../../lib/groupAnalytics';
import CashBankTabs from '../components/CashBankTabs';
import { useJurnalRekonTxs, type CashBankTxReal } from '../lib/useBankCashRekon';

// Tab Posted (Cash & Bank) = daftar jurnal Kas vs Hutang/Piutang hasil rekonsiliasi yang SUDAH
// diposting lewat tombol "Post Journal" di tab Journal Preview. Sumbernya sama dengan Journal
// Preview (useJurnalRekonTxs -> /api/v1/finance/bank-reconciliation/journal-preview), difilter ke
// status Posted, jadi begitu jurnal diposting, datanya otomatis pindah/muncul di sini.
//
// Halaman ini hanya MEMBACA. Kolom "Diposting Oleh" / "Waktu Posting" membaca posted_by /
// posted_at dari /journal-preview; selama backend belum mengirim field itu, isinya tampil "—".

const PAGE_SIZE = 10;
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

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

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function eksporCsv(rows: CashBankTxReal[]) {
  const header = [
    'No. Jurnal', 'Tanggal Jurnal', 'Arah', 'Counterparty', 'Invoice Terkait',
    'Rekening Kas/Bank', 'Akun Lawan', 'Nominal', 'Outstanding Sebelum', 'Outstanding Sesudah',
    'Diposting Oleh', 'Waktu Posting',
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
    r.linkedInvoice?.outstandingBefore ?? '',
    r.linkedInvoice?.outstandingAfter ?? '',
    r.postedBy ?? '',
    r.postedAt ?? '',
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
  { label: 'No. Jurnal', field: 'tx_no' },
  { label: 'Tanggal Jurnal', field: 'tx_date' },
  { label: 'Arah' },
  { label: 'Counterparty', field: 'counterparty' },
  { label: 'Invoice Terkait' },
  { label: 'Rekening Kas/Bank' },
  { label: 'Nominal', field: 'amount', align: 'right' },
  { label: 'Diposting Oleh' },
  { label: 'Waktu Posting' },
  { label: 'Detail' },
];

export default function CashBankPostedPage() {
  const { activeClientId } = useActiveClient();
  const { txs, loading, error, refresh } = useJurnalRekonTxs();

  const posted = useMemo(() => txs.filter((x) => x.posting_status === 'Posted'), [txs]);

  const [search, setSearch] = useState('');
  const [arahFilter, setArahFilter] = useState<'all' | 'Cash Payment' | 'Cash Receipt'>('all');
  const [periodeFilter, setPeriodeFilter] = useState('all');
  const [bankFilter, setBankFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('tx_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

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
  }, [search, arahFilter, periodeFilter, bankFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);
  const dariItem = filtered.length === 0 ? 0 : (pageSafe - 1) * PAGE_SIZE + 1;
  const sampaiItem = Math.min(pageSafe * PAGE_SIZE, filtered.length);

  const ringkasan = useMemo(() => {
    const cashIn = posted.filter((x) => x.direction === 'Cash Receipt').reduce((n, x) => n + x.amount, 0);
    const cashOut = posted.filter((x) => x.direction === 'Cash Payment').reduce((n, x) => n + x.amount, 0);
    return { total: posted.length, cashIn, cashOut, net: cashIn - cashOut, periode: periodeList.length };
  }, [posted, periodeList]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const adaFilter = search !== '' || arahFilter !== 'all' || periodeFilter !== 'all' || bankFilter !== 'all';

  return (
    <div className="p-6">
      <CashBankTabs />

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 mb-6">
          <span>{error}</span>
          <button onClick={refresh} className="font-semibold underline hover:no-underline shrink-0">
            Coba lagi
          </button>
        </div>
      )}

      {!activeClientId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 mb-6">
          Belum ada client aktif — pilih client dulu lewat Switch Company di Topbar.
        </div>
      )}

      {/* Ringkasan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          title="Jurnal Diposting"
          value={String(ringkasan.total)}
          icon="CheckBadgeIcon"
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
          subLabel={`${ringkasan.periode} periode akuntansi`}
        />
        <KpiCard title="Total Cash In" value={ringkasan.cashIn} icon="ArrowDownCircleIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <KpiCard title="Total Cash Out" value={ringkasan.cashOut} icon="ArrowUpCircleIcon" iconColor="text-rose-600" iconBg="bg-rose-50" />
        <KpiCard
          title="Net Cash Flow"
          value={ringkasan.net}
          icon="ScaleIcon"
          iconColor={ringkasan.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}
          iconBg={ringkasan.net >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}
        />
      </div>

      {/* Filter */}
      <div className="card-elevated-md rounded-xl p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nomor jurnal, counterparty, invoice, atau rekening..."
              className="w-full text-xs border border-border rounded-lg pl-9 pr-3 py-2 bg-card text-foreground"
            />
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <FunnelIcon className="w-4 h-4 text-muted-foreground" />
            <select
              value={arahFilter}
              onChange={(e) => setArahFilter(e.target.value as typeof arahFilter)}
              className="text-xs border border-border rounded-lg px-3 py-2 bg-card text-foreground"
            >
              <option value="all">Semua Arah</option>
              <option value="Cash Payment">Cash Payment</option>
              <option value="Cash Receipt">Cash Receipt</option>
            </select>
            <select
              value={periodeFilter}
              onChange={(e) => setPeriodeFilter(e.target.value)}
              className="text-xs border border-border rounded-lg px-3 py-2 bg-card text-foreground"
            >
              <option value="all">Semua Periode</option>
              {periodeList.map((p) => (
                <option key={p} value={p}>{labelPeriode(p)}</option>
              ))}
            </select>
            <select
              value={bankFilter}
              onChange={(e) => setBankFilter(e.target.value)}
              className="text-xs border border-border rounded-lg px-3 py-2 bg-card text-foreground max-w-[220px]"
            >
              <option value="all">Semua Rekening</option>
              {bankList.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <button
              onClick={() => eksporCsv(filtered)}
              disabled={filtered.length === 0}
              className="flex items-center gap-1.5 text-xs font-semibold border border-border rounded-lg px-3 py-2 bg-card text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {filtered.length} dari {posted.length} jurnal diposting
        </p>
      </div>

      {/* Tabel */}
      <div className="card-elevated-md rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                {KOLOM.map((col) => (
                  <th
                    key={col.label}
                    onClick={col.field ? () => handleSort(col.field!) : undefined}
                    className={`px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap select-none ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    } ${col.field ? 'cursor-pointer hover:text-foreground' : ''}`}
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
                  <td colSpan={KOLOM.length} className="px-4 py-12 text-center text-xs text-muted-foreground">
                    {loading
                      ? 'Memuat data...'
                      : adaFilter
                      ? 'Tidak ada jurnal yang cocok dengan filter.'
                      : 'Belum ada jurnal yang diposting. Jurnal muncul di sini setelah diposting lewat tab Journal Preview.'}
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
                      <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-primary whitespace-nowrap">{row.tx_no}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatTanggal(row.tx_date)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusBadge label={row.direction} variant={isReceipt ? 'positive' : 'negative'} />
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-foreground max-w-[200px] truncate">{row.counterparty}</td>
                        <td className="px-4 py-3 font-mono text-xs text-foreground max-w-[180px] truncate">{row.linkedInvoice?.no ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">{row.bank_account || '—'}</td>
                        <td className={`px-4 py-3 text-xs font-mono font-semibold text-right whitespace-nowrap ${isReceipt ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {formatIDR(row.amount)}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.postedBy || '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatWaktu(row.postedAt)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            onClick={() => setExpandedId(terbuka ? null : row.id)}
                            className="text-xs text-primary hover:underline flex items-center gap-0.5"
                          >
                            {terbuka ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
                            {terbuka ? 'Tutup' : 'Detail'}
                          </button>
                        </td>
                      </tr>

                      {terbuka && (
                        <tr className="border-b border-border/50">
                          <td colSpan={KOLOM.length} className="px-4 py-0 bg-muted/20">
                            <div className="py-4 space-y-3">
                              {/* Info jurnal & invoice */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {[
                                  { label: 'Tipe Invoice', value: row.linkedInvoice?.type ?? '—' },
                                  { label: 'Akun Lawan', value: row.linkedInvoice?.counterpartyAccount ?? '—' },
                                  {
                                    label: 'Outstanding Sebelum',
                                    value: row.linkedInvoice ? formatIDR(row.linkedInvoice.outstandingBefore) : '—',
                                  },
                                  {
                                    label: 'Outstanding Sesudah',
                                    value: row.linkedInvoice ? formatIDR(row.linkedInvoice.outstandingAfter) : '—',
                                  },
                                ].map((item) => (
                                  <div key={item.label} className="bg-card rounded-lg px-3 py-2 border border-border">
                                    <p className="text-xs text-muted-foreground">{item.label}</p>
                                    <p className="text-xs font-semibold text-foreground mt-0.5 break-words">{item.value}</p>
                                  </div>
                                ))}
                              </div>

                              {/* Baris jurnal */}
                              <div className="bg-card rounded-lg border border-border overflow-hidden">
                                <div className="px-3 py-2 bg-muted/30 border-b border-border">
                                  <p className="text-xs font-semibold text-foreground">Baris Jurnal</p>
                                </div>
                                {baris.length === 0 ? (
                                  <p className="px-3 py-4 text-xs text-muted-foreground">Baris jurnal tidak tersedia.</p>
                                ) : (
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-border">
                                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-10">No</th>
                                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Akun</th>
                                        <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Debit</th>
                                        <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Kredit</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                      {baris.map((l) => (
                                        <tr key={l.no}>
                                          <td className="px-3 py-2 text-muted-foreground">{l.no}</td>
                                          <td className="px-3 py-2 text-foreground">
                                            <span className="font-mono">{l.code}</span> · {l.name}
                                          </td>
                                          <td className="px-3 py-2 text-right font-mono tabular-nums">{l.debit > 0 ? formatIDR(l.debit) : '—'}</td>
                                          <td className="px-3 py-2 text-right font-mono tabular-nums">{l.credit > 0 ? formatIDR(l.credit) : '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className={`border-t ${seimbang ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                                        <td colSpan={2} className={`px-3 py-2 text-right font-bold ${seimbang ? 'text-emerald-700' : 'text-rose-700'}`}>
                                          Total {seimbang ? '· Seimbang' : '· Tidak seimbang'}
                                        </td>
                                        <td className={`px-3 py-2 text-right font-bold font-mono tabular-nums ${seimbang ? 'text-emerald-700' : 'text-rose-700'}`}>
                                          {formatIDR(totalDebit)}
                                        </td>
                                        <td className={`px-3 py-2 text-right font-bold font-mono tabular-nums ${seimbang ? 'text-emerald-700' : 'text-rose-700'}`}>
                                          {formatIDR(totalKredit)}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                )}
                              </div>

                              {/* Indikator posted */}
                              <div className="flex items-center gap-2 bg-emerald-50 rounded-lg px-4 py-2.5">
                                <CheckBadgeIcon className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                                <p className="text-xs text-emerald-700 font-medium">
                                  Jurnal ini sudah diposting ke buku besar
                                  {row.linkedInvoice ? ` dan outstanding invoice ${row.linkedInvoice.no} sudah diperbarui.` : '.'}
                                </p>
                              </div>
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

        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Menampilkan <span className="font-medium text-foreground">{dariItem}–{sampaiItem}</span> dari{' '}
              <span className="font-medium text-foreground">{filtered.length}</span> jurnal
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(pageSafe - 1)}
                disabled={pageSafe <= 1}
                className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Halaman sebelumnya"
              >
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
              <span className="text-xs text-muted-foreground px-2">
                {pageSafe} / {totalPages}
              </span>
              <button
                onClick={() => setPage(pageSafe + 1)}
                disabled={pageSafe >= totalPages}
                className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Halaman berikutnya"
              >
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}