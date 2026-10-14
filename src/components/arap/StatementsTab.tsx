'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CalendarDays, ChevronDown, Download, Eye, FileSpreadsheet, FileText, Filter, Loader2, Mail, MapPin, MoreHorizontal, Phone, Printer,
  Search, Trash2, X,
} from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import {
  createStatementLog, deleteStatementLog, emailStatement, fetchArApParties, fetchArCustomers, fetchPartyStatement, fetchStatementLogs, fmtDate,
  fmtDateLong, fmtDateTime, markStatementDownloaded, rupiah, useArApData,
  type ArApParty, type ArCustomer, type PartyStatement, type SideConfig, type StatementLog,
} from '@/lib/receivablesPayablesStore';
import { buildStatementPdf, downloadStatementXlsx, type ReportHeader } from './arapExport';
import { btnOutline, btnPrimary, btnSmall, Card, EmptyRow, inputCls, Menu, MenuItem, NumberPager } from './arapUi';

// Tab Customer / Vendor Statements (dataset/picture/Template UI/Account
// Receivable/5.jpeg): form Generate Statement (pihak, periode, mata uang,
// Open Items Only), preview mutasi (saldo awal, invoice, pelunasan, saldo
// berjalan), dan riwayat statement yang sudah di-generate + Email / Download
// PDF / Preview. Riwayat: /statements (receivables_ar_v1.py).

export function useReportHeader(): ReportHeader {
  const { clients, activeClientId, activeClientName } = useActiveClient();
  const { user } = useAuth();
  const c = clients.find(x => String(x.id) === String(activeClientId));
  const asli = (s?: string | null) => (s && s.trim() && s.trim() !== '-' ? s.trim() : null);
  return {
    clientName: asli(c?.companyName) ?? activeClientName ?? '',
    clientLogo: c?.logo ?? null,
    clientLines: [asli(c?.address), asli(c?.contactEmail), asli(c?.contactPhone)].filter((x): x is string => !!x),
    generatedBy: user?.nama || user?.username || null,
  };
}

const DELIVERY: Record<StatementLog['delivery_status'], { label: string; cls: string }> = {
  generated: { label: 'Generated', cls: 'bg-slate-100 text-slate-700' },
  sent: { label: 'Sent', cls: 'bg-emerald-50 text-emerald-700' },
  downloaded: { label: 'Downloaded', cls: 'bg-sky-50 text-sky-700' },
  failed: { label: 'Failed', cls: 'bg-rose-50 text-rose-700' },
};

const awalBulan = (iso: string) => `${iso.slice(0, 7)}-01`;
const sehariSebelum = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const blobKeBase64 = (b: Blob) => new Promise<string>((ok, gagal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => gagal(r.error);
  r.readAsDataURL(b);
});

export default function StatementsTab({ cfg, clientId, asOf, initialParty }: {
  cfg: SideConfig; clientId: string; asOf: string; initialParty: string;
}) {
  const header = useReportHeader();
  const [party, setParty] = useState(initialParty);
  const [cariPihak, setCariPihak] = useState('');
  const [dari, setDari] = useState(awalBulan(asOf));
  const [sampai, setSampai] = useState(asOf);
  const [terbuka, setTerbuka] = useState(false);
  const [log, setLog] = useState<StatementLog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [emailUntuk, setEmailUntuk] = useState<StatementLog | null>(null);
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState<'all' | StatementLog['delivery_status']>('all');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(5);
  useEffect(() => { if (initialParty) setParty(initialParty); }, [initialParty]);

  const parties = useArApData<ArApParty[]>(`parties:${cfg.side}:${clientId}`, s => fetchArApParties(cfg.side, clientId, s), []);
  const customers = useArApData<ArCustomer[]>(cfg.side === 'ar' ? `cust:${clientId}` : null, s => fetchArCustomers(clientId, s), []);
  const logs = useArApData<StatementLog[]>(`stlog:${cfg.side}:${clientId}`, s => fetchStatementLogs(cfg.side, clientId, s), []);
  const urut = useMemo(() => [...parties.data].sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name)), [parties.data]);
  useEffect(() => { if (!party && urut.length) setParty(urut[0].name); }, [party, urut]);
  const kontak = (nama: string) => customers.data.find(c => c.name === nama) ?? null;
  const k = kontak(party);

  const valid = !!party && dari <= sampai;
  const st = useArApData<PartyStatement | null>(
    valid ? `stmt:${cfg.side}:${clientId}:${party}:${dari}:${sampai}` : null,
    s => fetchPartyStatement(cfg.side, clientId, party, dari, sampai, s), null,
  );
  const s = st.data;
  // Log yang sedang ditampilkan hanya berlaku selama parameternya sama.
  const logAktif = log && log.party === party && log.date_from === dari && log.date_to === sampai && log.open_items_only === terbuka ? log : null;

  const generate = async (diam = false): Promise<StatementLog | null> => {
    if (!valid) return null;
    if (logAktif) return logAktif;
    try {
      const r = await createStatementLog(cfg.side, { client_id: clientId, party, date_from: dari, date_to: sampai, currency: 'IDR', open_items_only: terbuka });
      setLog(r.data);
      if (!diam) toast.success(`Statement for ${party} generated.`);
      return r.data;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    }
  };

  const buatPdf = async (data: PartyStatement, openItems: boolean) => {
    const c = kontak(data.party);
    return buildStatementPdf({
      cfg, header, st: data, includeSummary: true, paper: 'a4', orientation: 'portrait', openItemsOnly: openItems,
      partyCode: c?.code ?? null, partyLines: [c?.billing_address?.replace(/\s*\n\s*/g, ', ') ?? '', [c?.phone, c?.email].filter(Boolean).join(' · ')],
    });
  };
  const namaFile = (l: { party: string; date_to: string }) => `${cfg.short}-Statement-${l.party.replace(/[^A-Za-z0-9]+/g, '_')}-${l.date_to}.pdf`;
  const dataUntuk = async (l: StatementLog) => (l.party === party && l.date_from === dari && l.date_to === sampai && s)
    ? s : fetchPartyStatement(cfg.side, clientId, l.party, l.date_from, l.date_to);

  const unduh = async (l: StatementLog | null) => {
    setBusy(l ? `dl:${l.id}` : 'dl');
    try {
      const target = l ?? await generate(true);
      if (!target) return;
      const doc = await buatPdf(await dataUntuk(target), target.open_items_only);
      doc.save(namaFile(target));
      await markStatementDownloaded(cfg.side, clientId, target.id).catch(() => {});
    } catch (e) {
      toast.error((e as Error).message || 'Failed to build the PDF.');
    } finally {
      setBusy(null);
    }
  };
  const cetak = async () => {
    if (!s) return;
    setBusy('print');
    try {
      const doc = await buatPdf(s, terbuka);
      doc.autoPrint();
      window.open(doc.output('bloburl').toString(), '_blank');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to build the PDF.');
    } finally {
      setBusy(null);
    }
  };
  const bukaEmail = async (l: StatementLog | null) => {
    const target = l ?? await generate(true);
    if (target) setEmailUntuk(target);
  };
  const lihatLog = (l: StatementLog) => {
    setParty(l.party); setDari(l.date_from); setSampai(l.date_to); setTerbuka(l.open_items_only); setLog(l);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const hapusLog = async (l: StatementLog) => {
    try {
      const r = await deleteStatementLog(cfg.side, clientId, l.id);
      toast.success(r.message);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const daftarPihak = urut.filter(p => !cariPihak.trim() || p.name.toLowerCase().includes(cariPihak.trim().toLowerCase()));
  const logTersaring = useMemo(() => {
    const kata = q.trim().toLowerCase();
    return logs.data.filter(l => (fStatus === 'all' || l.delivery_status === fStatus)
      && (!kata || l.party.toLowerCase().includes(kata) || (l.party_code ?? '').toLowerCase().includes(kata)
        || `${fmtDate(l.date_from)} - ${fmtDate(l.date_to)}`.toLowerCase().includes(kata)));
  }, [logs.data, q, fStatus]);
  useEffect(() => setPage(0), [q, fStatus, size]);
  const halamanLog = logTersaring.slice(page * size, (page + 1) * size);
  const terbukaRows = s?.open_invoices ?? [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(320px,0.75fr)_1.6fr]">
        <Card title={`Generate ${cfg.party} Statement`} subtitle={`Choose a ${cfg.party.toLowerCase()} and period to build a ${cfg.side === 'ar' ? 'receivable' : 'payable'} statement.`}>
          <div className="space-y-4 px-5 pb-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">{cfg.party} <span className="text-rose-500">*</span></label>
              <Menu align="left" width="w-full" button={open => (
                <button type="button" className={`${inputCls} flex items-center gap-2 text-left`}>
                  <Search size={14} className="text-muted-foreground" />
                  <span className={`flex-1 truncate ${party ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {party ? `${party}${kontak(party)?.code ? ` (${kontak(party)!.code})` : ''}` : parties.loading ? 'Loading...' : `Select ${cfg.party.toLowerCase()}`}
                  </span>
                  <ChevronDown size={14} className={`text-muted-foreground ${open ? 'rotate-180' : ''}`} />
                </button>
              )}>
                {close => (
                  <div>
                    <input autoFocus value={cariPihak} onChange={e => setCariPihak(e.target.value)} placeholder={`Search ${cfg.party.toLowerCase()}...`}
                      className="mb-1 w-full rounded-lg border border-border px-2.5 py-1.5 text-sm focus:outline-none" />
                    <div className="max-h-64 overflow-y-auto">
                      {daftarPihak.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No {cfg.parties.toLowerCase()} found.</p>}
                      {daftarPihak.map(p => (
                        <MenuItem key={p.name} onClick={() => { setParty(p.name); setCariPihak(''); close(); }}>
                          <span className="min-w-0 flex-1 truncate">{p.name}{kontak(p.name)?.code ? ` (${kontak(p.name)!.code})` : ''}</span>
                          <span className="shrink-0 text-muted-foreground">{p.outstanding ? rupiah(p.outstanding) : 'no balance'}</span>
                        </MenuItem>
                      ))}
                    </div>
                  </div>
                )}
              </Menu>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Statement Period <span className="text-rose-500">*</span></label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="date" value={dari} max={sampai} onChange={e => setDari(e.target.value)} className={`${inputCls} pl-8`} aria-label="Period start" />
                </div>
                <span className="text-xs text-muted-foreground">to</span>
                <input type="date" value={sampai} min={dari} onChange={e => setSampai(e.target.value)} className={`${inputCls} flex-1`} aria-label="Period end" />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                {[
                  ['This month', awalBulan(asOf), asOf],
                  ['Last month', awalBulan(sehariSebelum(awalBulan(asOf))), sehariSebelum(awalBulan(asOf))],
                  ['Year to date', `${asOf.slice(0, 4)}-01-01`, asOf],
                ].map(([l, a, b]) => (
                  <button key={l} type="button" onClick={() => { setDari(a); setSampai(b); }}
                    className={`rounded-full border px-2 py-0.5 ${dari === a && sampai === b ? 'border-[#0F7D4E] bg-[#ECFDF5] text-[#0F7D4E]' : 'border-border text-muted-foreground hover:text-foreground'}`}>{l}</button>
                ))}
              </div>
              {dari > sampai && <p className="mt-1 text-xs text-rose-600">The start date must not be after the end date.</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Currency</label>
              <select className={inputCls} value="IDR" onChange={() => {}}><option value="IDR">IDR - Indonesian Rupiah</option></select>
            </div>
            <div className="flex items-start gap-3">
              <button type="button" role="switch" aria-checked={terbuka} onClick={() => setTerbuka(v => !v)}
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${terbuka ? 'bg-[#0F7D4E]' : 'bg-slate-200'}`}>
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${terbuka ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
              <div>
                <p className="text-sm font-medium text-foreground">Open Items Only</p>
                <p className="text-xs text-muted-foreground">Show only {cfg.docs.toLowerCase()} that are still open as of the end date.</p>
              </div>
            </div>
            <button type="button" onClick={() => generate()} disabled={!valid || !!busy || !!logAktif} className={`${btnPrimary} w-full`}>
              <FileText size={16} /> {logAktif ? 'Statement Generated' : 'Generate Statement'}
            </button>
          </div>
        </Card>

        <Card title={`${cfg.party} Statement Preview`} subtitle={`Summary of ${cfg.side === 'ar' ? 'receivable' : 'payable'} activity for the selected period.`}
          action={<>
            <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${logAktif ? 'bg-[#ECFDF5] text-[#0F7D4E]' : 'bg-slate-100 text-slate-600'}`}>{logAktif ? 'Generated' : 'Preview'}</span>
            <button type="button" className={btnSmall} disabled={!s || !!busy} onClick={() => bukaEmail(null)}><Mail size={13} /> Email</button>
            <button type="button" className={btnSmall} disabled={!s || !!busy} onClick={() => unduh(null)}>
              {busy === 'dl' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF
            </button>
            <button type="button" className={btnSmall} disabled={!s} onClick={() => s && downloadStatementXlsx(cfg, header.clientName, s)}><FileSpreadsheet size={13} /> Excel</button>
            <button type="button" className={btnSmall} disabled={!s || !!busy} onClick={cetak}><Printer size={13} /> Print</button>
          </>}>
          {st.error && <p className="mx-5 mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{st.error}</p>}
          <div className="mx-5 mb-4 flex flex-col gap-3 rounded-xl border border-border bg-slate-50/60 p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-lg font-bold text-foreground">
                {party || '—'}{k?.code && <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">{k.code}</span>}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {k?.billing_address && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {k.billing_address.replace(/\s*\n\s*/g, ', ')}</span>}
                {k?.phone && <span className="inline-flex items-center gap-1"><Phone size={12} /> {k.phone}</span>}
                {k?.email && <span className="inline-flex items-center gap-1"><Mail size={12} /> {k.email}</span>}
                {s?.party_tax_id && <span>NPWP {s.party_tax_id}</span>}
                {cfg.side === 'ar' && party && !k?.billing_address && !k?.email && <span className="italic">No address or email yet — add them in Create Invoice &gt; customer details.</span>}
              </div>
            </div>
            <div className="shrink-0 text-xs sm:border-l sm:border-border sm:pl-4">
              <p className="text-muted-foreground">Statement Period</p>
              <p className="inline-flex items-center gap-1 font-semibold text-foreground"><CalendarDays size={12} /> {fmtDate(dari)} - {fmtDate(sampai)}</p>
            </div>
          </div>
          <div className="overflow-x-auto px-5">
            {terbuka ? (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-y border-border bg-slate-50 text-xs text-slate-600">
                    <th className="px-3 py-2.5 text-left font-medium">Date</th>
                    <th className="px-3 py-2.5 text-left font-medium">Reference</th>
                    <th className="px-3 py-2.5 text-left font-medium">Due Date</th>
                    <th className="px-3 py-2.5 text-right font-medium">Total (Rp)</th>
                    <th className="px-3 py-2.5 text-right font-medium">{cfg.settled} (Rp)</th>
                    <th className="px-3 py-2.5 text-right font-medium">Outstanding (Rp)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {!s ? <EmptyRow cols={6} loading={st.loading} text={`Choose a ${cfg.party.toLowerCase()} and period.`} />
                    : terbukaRows.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">No open {cfg.docs.toLowerCase()} as of {fmtDate(sampai)}.</td></tr>
                      : terbukaRows.map(d => (
                        <tr key={d.id}>
                          <td className="px-3 py-2 text-muted-foreground">{fmtDate(d.date)}</td>
                          <td className="px-3 py-2 text-foreground">{d.no}</td>
                          <td className={`px-3 py-2 ${d.days_overdue ? 'text-rose-600' : 'text-muted-foreground'}`}>{fmtDate(d.due_date)}{d.days_overdue ? ` (${d.days_overdue}d)` : ''}</td>
                          <td className="px-3 py-2 text-right">{rupiah(d.total)}</td>
                          <td className="px-3 py-2 text-right text-emerald-700">{d.paid ? rupiah(d.paid) : '-'}</td>
                          <td className="px-3 py-2 text-right font-medium">{rupiah(d.outstanding)}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-y border-border bg-slate-50 text-xs text-slate-600">
                    <th className="px-3 py-2.5 text-left font-medium">Date</th>
                    <th className="px-3 py-2.5 text-left font-medium">Description</th>
                    <th className="px-3 py-2.5 text-left font-medium">Reference</th>
                    <th className="px-3 py-2.5 text-right font-medium">Debit (Rp)</th>
                    <th className="px-3 py-2.5 text-right font-medium">Credit (Rp)</th>
                    <th className="px-3 py-2.5 text-right font-medium">Balance (Rp)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {!s ? <EmptyRow cols={6} loading={st.loading} text={`Choose a ${cfg.party.toLowerCase()} and period.`} /> : (
                    <>
                      <tr className="font-semibold text-[#0F7D4E]">
                        <td className="px-3 py-2">{fmtDate(sehariSebelum(s.date_from))}</td>
                        <td className="px-3 py-2">Beginning Balance</td>
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 text-right">-</td>
                        <td className="px-3 py-2 text-right">-</td>
                        <td className="px-3 py-2 text-right">{rupiah(s.opening_balance).replace('Rp ', '')}</td>
                      </tr>
                      {s.lines.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">No activity in this period.</td></tr>}
                      {s.lines.map((l, i) => {
                        // AR: invoice = debit, pelunasan = kredit. AP: kebalikannya dari sisi vendor, tetap ditampilkan charge/settlement.
                        const tipe: Record<string, string> = { invoice: 'Invoice', bill: 'Bill', settlement: cfg.settle, reversal: 'Reversal', settled_outside: 'Settled' };
                        return (
                          <tr key={`${l.number}-${i}`} className="hover:bg-slate-50/60">
                            <td className="px-3 py-2 text-muted-foreground">{fmtDate(l.date)}</td>
                            <td className="px-3 py-2 text-foreground" title={l.description}>{tipe[l.type] ?? l.type}</td>
                            <td className="px-3 py-2 text-muted-foreground">{l.number}</td>
                            <td className="px-3 py-2 text-right">{l.charge ? rupiah(l.charge).replace('Rp ', '') : '-'}</td>
                            <td className="px-3 py-2 text-right">{l.settlement ? rupiah(l.settlement).replace('Rp ', '') : '-'}</td>
                            <td className="px-3 py-2 text-right">{rupiah(l.balance).replace('Rp ', '')}</td>
                          </tr>
                        );
                      })}
                    </>
                  )}
                </tbody>
              </table>
            )}
          </div>
          {s && (
            <div className="mx-5 mb-5 mt-3 flex items-center justify-between rounded-xl bg-[#ECFDF5] px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Outstanding Balance as of {fmtDateLong(s.date_to)}</span>
              <span className="text-lg font-bold text-foreground">{rupiah(s.closing_balance)}</span>
            </div>
          )}
        </Card>
      </div>

      <Card title={`Recent ${cfg.party} Statements`} subtitle={`${cfg.parties} that already have a generated statement.`}
        action={<>
          <label className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 sm:w-72">
            <Search size={14} className="text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${cfg.party.toLowerCase()}, period...`}
              className="w-full bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none" />
          </label>
          <Menu width="w-48" button={open => (
            <button type="button" className={`${btnSmall} py-2 ${fStatus !== 'all' ? 'border-[#0F7D4E] text-[#0F7D4E]' : ''}`}>
              <Filter size={13} /> {fStatus === 'all' ? 'Filter' : DELIVERY[fStatus].label} <ChevronDown size={13} className={open ? 'rotate-180' : ''} />
            </button>
          )}>
            {close => (
              <>
                <MenuItem onClick={() => { setFStatus('all'); close(); }}>All deliveries</MenuItem>
                {(Object.keys(DELIVERY) as StatementLog['delivery_status'][]).map(d => (
                  <MenuItem key={d} onClick={() => { setFStatus(d); close(); }}>{DELIVERY[d].label}</MenuItem>
                ))}
              </>
            )}
          </Menu>
        </>}>
        <div className="overflow-x-auto px-5">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-y border-border bg-slate-50 text-xs text-slate-600">
                <th className="px-3 py-2.5 text-left font-medium">{cfg.party}</th>
                <th className="px-3 py-2.5 text-left font-medium">Period</th>
                <th className="px-3 py-2.5 text-right font-medium">Balance (Rp)</th>
                <th className="px-3 py-2.5 text-left font-medium">Last Generated</th>
                <th className="px-3 py-2.5 text-left font-medium">Delivery Method</th>
                <th className="px-3 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(logs.loading && !logs.data.length) || halamanLog.length === 0 ? (
                <EmptyRow cols={6} loading={logs.loading && !logs.data.length} text={logs.data.length ? 'No matching statements.' : 'No statements generated yet.'} />
              ) : halamanLog.map(l => (
                <tr key={l.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-foreground">{l.party}</span>
                    {l.party_code && <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{l.party_code}</span>}
                    {l.open_items_only && <span className="ml-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Open items</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(l.date_from)} - {fmtDate(l.date_to)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-foreground">{rupiah(l.closing_balance)}</td>
                  <td className="px-3 py-2.5 text-xs">
                    <span className="text-foreground">{fmtDateTime(l.generated_at)}</span>
                    <span className="block text-muted-foreground">by {l.generated_by_name || '—'}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <span className="inline-flex items-center gap-2">
                      {l.delivery_method === 'email' ? <Mail size={13} className="text-sky-600" /> : l.delivery_method === 'download' ? <Download size={13} className="text-sky-600" /> : <FileText size={13} className="text-muted-foreground" />}
                      <span className="text-foreground">{l.delivery_method === 'email' ? 'Email' : l.delivery_method === 'download' ? 'Download' : '—'}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${DELIVERY[l.delivery_status].cls}`}>{DELIVERY[l.delivery_status].label}</span>
                    </span>
                    {l.recipient_email && <span className="block truncate text-[11px] text-muted-foreground" title={l.recipient_email}>{l.recipient_email}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" className={btnSmall} disabled={!!busy} onClick={() => bukaEmail(l)}><Mail size={13} /> Email Statement</button>
                      <button type="button" className={btnSmall} disabled={!!busy} onClick={() => unduh(l)}>
                        {busy === `dl:${l.id}` ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download PDF
                      </button>
                      <button type="button" className={btnSmall} onClick={() => lihatLog(l)}><Eye size={13} /> Preview</button>
                      <Menu width="w-48" button={() => <button type="button" className={`${btnSmall} px-2`} aria-label="More actions"><MoreHorizontal size={14} /></button>}>
                        {close => <MenuItem danger onClick={() => { close(); hapusLog(l); }}><Trash2 size={14} /> Remove from history</MenuItem>}
                      </Menu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <NumberPager page={page} pageSize={size} total={logTersaring.length} onPage={setPage} onPageSize={setSize} noun="statements" sizes={[5, 10, 25, 50]} />
      </Card>

      {emailUntuk && (
        <EmailModal cfg={cfg} clientId={clientId} log={emailUntuk} defaultTo={kontak(emailUntuk.party)?.email ?? emailUntuk.party_email ?? ''}
          canSaveEmail={cfg.side === 'ar' && !!kontak(emailUntuk.party)?.id && !kontak(emailUntuk.party)?.email}
          clientName={header.clientName} fileName={namaFile(emailUntuk)}
          buildPdf={async () => (await buatPdf(await dataUntuk(emailUntuk), emailUntuk.open_items_only)).output('blob')}
          onClose={() => setEmailUntuk(null)} />
      )}
    </div>
  );
}

function EmailModal({ cfg, clientId, log, defaultTo, canSaveEmail, clientName, fileName, buildPdf, onClose }: {
  cfg: SideConfig; clientId: string; log: StatementLog; defaultTo: string; canSaveEmail: boolean; clientName: string; fileName: string;
  buildPdf: () => Promise<Blob>; onClose: () => void;
}) {
  const periode = `${fmtDateLong(log.date_from)} - ${fmtDateLong(log.date_to)}`;
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState('');
  const [subjek, setSubjek] = useState(`${cfg.party} Statement — ${log.party} — ${periode}`);
  const [pesan, setPesan] = useState(
    `Dear ${log.party},\n\nPlease find attached your ${cfg.party.toLowerCase()} statement for ${periode}. `
    + `The outstanding balance as of ${fmtDateLong(log.date_to)} is ${rupiah(log.closing_balance)}.\n\n`
    + `Kindly review it and let us know if anything does not match your records.\n\nBest regards,\n${clientName}`,
  );
  const [simpanEmail, setSimpanEmail] = useState(canSaveEmail);
  const [busy, setBusy] = useState(false);
  const [gagal, setGagal] = useState<string | null>(null);

  const kirim = async () => {
    setBusy(true);
    setGagal(null);
    try {
      const pdf = await blobKeBase64(await buildPdf());
      const r = await emailStatement(cfg.side, log.id, {
        client_id: clientId, to, cc: cc || null, subject: subjek, message: pesan, pdf_base64: pdf, file_name: fileName, save_as_customer_email: simpanEmail,
      });
      toast.success(r.message);
      onClose();
    } catch (e) {
      setGagal((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const unduhManual = async () => {
    const url = URL.createObjectURL(await buildPdf());
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
    await markStatementDownloaded(cfg.side, clientId, log.id).catch(() => {});
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subjek)}&body=${encodeURIComponent(pesan)}${cc ? `&cc=${encodeURIComponent(cc)}` : ''}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-foreground">Email Statement</h3>
            <p className="text-xs text-muted-foreground">{log.party} · {periode} · PDF attached</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mt-4 space-y-3 text-xs">
          <label className="block font-medium text-foreground">To <span className="text-rose-500">*</span>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="finance@customer.co.id" className={`${inputCls} mt-1`} />
          </label>
          {canSaveEmail && (
            <label className="flex items-center gap-2 text-muted-foreground">
              <input type="checkbox" checked={simpanEmail} onChange={e => setSimpanEmail(e.target.checked)} className="accent-[#0F7D4E]" /> Save as this customer&apos;s email
            </label>
          )}
          <label className="block font-medium text-foreground">Cc
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder="Separate multiple addresses with commas" className={`${inputCls} mt-1`} />
          </label>
          <label className="block font-medium text-foreground">Subject
            <input value={subjek} onChange={e => setSubjek(e.target.value)} maxLength={255} className={`${inputCls} mt-1`} />
          </label>
          <label className="block font-medium text-foreground">Message
            <textarea value={pesan} onChange={e => setPesan(e.target.value)} rows={8} maxLength={5000} className={`${inputCls} mt-1`} />
          </label>
        </div>
        {gagal && (
          <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {gagal}
            <button type="button" onClick={unduhManual} className="mt-1 block font-semibold underline">Download the PDF and open my email app instead</button>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnOutline}>Cancel</button>
          <button type="button" onClick={kirim} disabled={busy || !to.trim() || !subjek.trim()} className={btnPrimary}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Send Email
          </button>
        </div>
      </div>
    </div>
  );
}
