'use client';

// Export PDF / Print Preview AR / AP (layout dataset/picture/Template UI/
// Account Receivable/3.jpeg): pengaturan laporan di kiri, pratinjau PDF
// (jsPDF -> blob URL di <iframe>, viewer PDF browser) di kanan, tombol
// Export PDF / Download (Excel) / Email / Print di atas.

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Building2, CalendarDays, ChevronRight, Download, FileText, Loader2, Mail, Printer, RefreshCcw, Users,
} from 'lucide-react';
import type jsPDF from 'jspdf';
import { useActiveClient } from '@/lib/activeClient';
import {
  fetchArApAging, fetchArApDocs, fetchArApParties, fetchPartyStatement, fmtDateLong, SIDE_CONFIG, todayIso, useArApData,
  type ArApParty, type ArApSide,
} from '@/lib/receivablesPayablesStore';
import {
  buildAgingPdf, buildDocListPdf, buildStatementPdf, downloadAgingXlsx, downloadDocsXlsx, downloadStatementXlsx,
  type Orientation, type PaperSize,
} from './arapExport';
import { btnOutline, btnPrimary, inputCls } from './arapUi';
import { useReportHeader } from './StatementsTab';

type ReportType = 'aging' | 'open_list' | 'statement';
const SEMUA = '__all__';
const TELAT = '__overdue__';

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${disabled ? 'opacity-40' : ''}`}>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-[#0F7D4E]' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function ExportPreviewInner({ side }: { side: ArApSide }) {
  const cfg = SIDE_CONFIG[side];
  const params = useSearchParams();
  const { clients, activeClientId, setActiveClient } = useActiveClient();
  const kid = activeClientId ? String(activeClientId) : null;
  const header = useReportHeader();

  const [jenis, setJenis] = useState<ReportType>((params.get('type') as ReportType) || 'aging');
  const [asOf, setAsOf] = useState(params.get('as_of') || todayIso());
  const [dari, setDari] = useState(`${(params.get('as_of') || todayIso()).slice(0, 4)}-01-01`);
  const [grup, setGrup] = useState(params.get('party') || SEMUA);
  const [ringkasan, setRingkasan] = useState(true);
  const [nol, setNol] = useState(false);
  const [detail, setDetail] = useState(false);
  const [kertas, setKertas] = useState<PaperSize>('a4');
  const [arah, setArah] = useState<Orientation>('portrait');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const docRef = useRef<jsPDF | null>(null);
  const excelRef = useRef<(() => Promise<void>) | null>(null);

  const parties = useArApData<ArApParty[]>(kid ? `parties:${side}:${kid}` : null, s => fetchArApParties(side, kid!, s), []);
  const daftarPihak = useMemo(() => [...parties.data].sort((a, b) => a.name.localeCompare(b.name)), [parties.data]);
  useEffect(() => {
    if (jenis === 'statement' && (grup === SEMUA || grup === TELAT) && parties.data.length) {
      setGrup([...parties.data].sort((a, b) => b.outstanding - a.outstanding)[0].name);
    }
  }, [jenis, grup, parties.data]);

  const labelGrup = grup === SEMUA ? `All ${cfg.parties.toLowerCase()}` : grup === TELAT ? `${cfg.parties} with overdue balance` : grup;
  const namaFile = `${cfg.short}-${jenis === 'aging' ? 'Aging' : jenis === 'open_list' ? `Open-${cfg.docs}` : 'Statement'}-${asOf}`;

  const buat = useCallback(async () => {
    if (!kid) return;
    setBusy(true);
    try {
      let doc: jsPDF;
      if (jenis === 'aging') {
        const rep = await fetchArApAging(side, kid, { as_of: asOf, include_zero: nol && grup === SEMUA, include_details: detail });
        const rows = grup === SEMUA ? rep.rows
          : grup === TELAT ? rep.rows.filter(r => r.total - r.buckets.current > 0)
            : rep.rows.filter(r => r.party === grup);
        const totals = { buckets: { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '91_plus': 0 }, total: 0 } as typeof rep.totals;
        rows.forEach(r => { totals.total += r.total; (Object.keys(totals.buckets) as (keyof typeof totals.buckets)[]).forEach(b => { totals.buckets[b] += r.buckets[b]; }); });
        const report = { ...rep, rows, totals };
        doc = await buildAgingPdf({ cfg, header, report, includeSummary: ringkasan, includeDetails: detail, partyFilterLabel: labelGrup, paper: kertas, orientation: arah });
        excelRef.current = () => downloadAgingXlsx(cfg, header.clientName, report, detail);
      } else if (jenis === 'open_list') {
        const semua = await fetchArApDocs(side, kid, { as_of: asOf, only_open: true });
        const docs = (grup === SEMUA ? semua : grup === TELAT ? semua.filter(d => d.days_overdue > 0) : semua.filter(d => d.party === grup))
          .sort((a, b) => a.party.localeCompare(b.party) || a.due_date.localeCompare(b.due_date));
        doc = await buildDocListPdf({ cfg, header, asOf, docs, partyFilterLabel: labelGrup, paper: kertas, orientation: arah });
        excelRef.current = () => downloadDocsXlsx(cfg, header.clientName, asOf, docs);
      } else {
        if (grup === SEMUA || grup === TELAT) throw new Error(`Choose one ${cfg.party.toLowerCase()} for a statement.`);
        if (dari > asOf) throw new Error('The start date must not be after the end date.');
        const st = await fetchPartyStatement(side, kid, grup, dari, asOf);
        doc = await buildStatementPdf({ cfg, header, st, includeSummary: ringkasan, paper: kertas, orientation: arah });
        excelRef.current = () => downloadStatementXlsx(cfg, header.clientName, st);
      }
      docRef.current = doc;
      const baru = URL.createObjectURL(doc.output('blob'));
      setUrl(lama => { if (lama) URL.revokeObjectURL(lama); return baru; });
    } catch (e) {
      toast.error((e as Error).message || 'Failed to build the report.');
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kid, side, jenis, asOf, dari, grup, ringkasan, nol, detail, kertas, arah, header.clientName, header.clientLogo, labelGrup]);

  // Pratinjau pertama otomatis begitu klien & daftar pihak siap.
  const sudah = useRef(false);
  useEffect(() => {
    if (sudah.current || !kid || parties.loading) return;
    if (jenis === 'statement' && (grup === SEMUA || grup === TELAT)) return;
    sudah.current = true;
    buat();
  }, [kid, parties.loading, jenis, grup, buat]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const unduhPdf = () => docRef.current?.save(`${namaFile}.pdf`);
  const cetak = () => {
    const f = document.getElementById('arap-preview') as HTMLIFrameElement | null;
    try {
      f?.contentWindow?.focus();
      f?.contentWindow?.print();
    } catch {
      if (url) window.open(url, '_blank');
    }
  };
  const email = () => {
    unduhPdf();
    const judul = `${cfg.title} ${jenis === 'aging' ? 'Aging Report' : jenis === 'open_list' ? `Open ${cfg.docs}` : 'Statement'} — ${header.clientName}`;
    const isi = `Hello,\n\nPlease find attached the ${judul} as of ${fmtDateLong(asOf)}.\n(The PDF has been downloaded — attach ${namaFile}.pdf to this email.)\n\nRegards,\n${header.generatedBy ?? ''}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(judul)}&body=${encodeURIComponent(isi)}`;
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <nav className="mb-1 flex items-center gap-2 text-sm">
              <Link href={cfg.basePath} className="text-[#0F7D4E] hover:underline">{cfg.title}</Link>
              <ChevronRight size={14} className="text-muted-foreground" />
              <span className="font-semibold text-foreground">Export / Print Preview</span>
            </nav>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Export PDF / Print Preview</h1>
            <p className="mt-1 text-sm text-muted-foreground">Generate and download {cfg.title} reports as PDF or Excel, or print and share them by email.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnPrimary} disabled={!url || busy} onClick={unduhPdf}><FileText size={16} /> Export PDF</button>
            <button type="button" className={btnOutline} disabled={!url || busy} onClick={() => excelRef.current?.()}><Download size={16} /> Download Excel</button>
            <button type="button" className={btnOutline} disabled={!url || busy} onClick={email}><Mail size={16} /> Email</button>
            <button type="button" className={btnOutline} disabled={!url || busy} onClick={cetak}><Printer size={16} /> Print</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-4 self-start rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-lg font-bold text-foreground">Export Settings</h2>
            <div>
              <label className="mb-1 block text-sm text-foreground">Report Type</label>
              <select value={jenis} onChange={e => setJenis(e.target.value as ReportType)} className={inputCls}>
                <option value="aging">{cfg.title} Aging Report</option>
                <option value="open_list">Open {cfg.docs} List</option>
                <option value="statement">{cfg.party} Statement</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-foreground">Client / Company</label>
              <div className="relative">
                <Building2 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <select value={kid ?? ''} onChange={e => {
                  const c = clients.find(x => String(x.id) === e.target.value);
                  setActiveClient(e.target.value || null, c?.companyName ?? null);
                  setGrup(SEMUA);
                }} className={`${inputCls} pl-9`}>
                  {clients.map(c => <option key={c.id} value={String(c.id)}>{c.companyName}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-foreground">Period</label>
              {jenis === 'statement' ? (
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={dari} onChange={e => setDari(e.target.value)} className={inputCls} aria-label="From" />
                  <input type="date" value={asOf} onChange={e => e.target.value && setAsOf(e.target.value)} className={inputCls} aria-label="To" />
                </div>
              ) : (
                <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                  <span className="flex items-center gap-2 rounded-xl border border-border bg-slate-50 px-3 py-2.5 text-sm text-foreground"><CalendarDays size={15} /> As of Date</span>
                  <input type="date" value={asOf} onChange={e => e.target.value && setAsOf(e.target.value)} className={inputCls} />
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm text-foreground">{cfg.party} Group</label>
              <div className="relative">
                <Users size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <select value={grup} onChange={e => setGrup(e.target.value)} className={`${inputCls} pl-9`}>
                  {jenis !== 'statement' && <option value={SEMUA}>All {cfg.parties}</option>}
                  {jenis !== 'statement' && <option value={TELAT}>{cfg.parties} with Overdue Balance</option>}
                  {daftarPihak.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <Toggle checked={ringkasan} onChange={setRingkasan} label="Include Aging Summary" hint="Show the summary by aging bucket" disabled={jenis === 'open_list'} />
            <Toggle checked={nol} onChange={setNol} label={`Include Zero Balance ${cfg.parties}`} hint={`List ${cfg.parties.toLowerCase()} whose balance is fully settled`} disabled={jenis !== 'aging' || grup !== SEMUA} />
            <Toggle checked={detail} onChange={setDetail} label={`Include ${cfg.doc} Details`} hint={`List the open ${cfg.docs.toLowerCase()} under each ${cfg.party.toLowerCase()}`} disabled={jenis !== 'aging'} />
            <div>
              <label className="mb-1 block text-sm text-foreground">Paper Size</label>
              <select value={kertas} onChange={e => setKertas(e.target.value as PaperSize)} className={inputCls}>
                <option value="a4">A4 (210 x 297 mm)</option>
                <option value="letter">Letter (216 x 279 mm)</option>
                <option value="legal">Legal (216 x 356 mm)</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">Orientation</span>
              <div className="flex gap-2">
                {(['portrait', 'landscape'] as Orientation[]).map(o => (
                  <button key={o} type="button" onClick={() => setArah(o)}
                    className={`rounded-lg border px-3 py-1.5 text-xs capitalize ${arah === o ? 'border-[#0F7D4E] bg-[#ECFDF5] font-semibold text-[#0F7D4E]' : 'border-border text-foreground'}`}>{o}</button>
                ))}
              </div>
            </div>
            <button type="button" onClick={buat} disabled={busy || !kid} className={`${btnPrimary} w-full py-3`}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />} Apply & Refresh Preview
            </button>
          </aside>

          <div className="min-h-[640px] overflow-hidden rounded-2xl border border-slate-700 bg-slate-600 shadow-sm">
            {url ? (
              <iframe id="arap-preview" title="Report preview" src={url} className="h-[80vh] min-h-[640px] w-full bg-slate-600" />
            ) : (
              <div className="flex h-[640px] items-center justify-center text-sm text-slate-200">
                {busy ? <><Loader2 size={18} className="mr-2 animate-spin" /> Building preview...</> : 'Choose the settings and click Apply & Refresh Preview.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExportPreview({ side }: { side: ArApSide }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading...</div>}>
      <ExportPreviewInner side={side} />
    </Suspense>
  );
}
