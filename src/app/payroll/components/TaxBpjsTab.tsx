'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { SectionCard, TD, TH } from './payrollUi';
import { periodLabel, type PayrollStore } from '../lib/payrollStore';
import { runTotals } from '../lib/payrollCalc';
import { rupiah } from '../lib/payrollExport';

type View = 'pph21' | 'bpjs' | 'ytd';

export default function TaxBpjsTab({ store }: { store: PayrollStore }) {
  const { runs } = store;
  const ordered = useMemo(() => [...runs].sort((a, b) => b.period.localeCompare(a.period)), [runs]);
  const [runId, setRunId] = useState<string | null>(null);
  const [view, setView] = useState<View>('pph21');
  const years = useMemo(() => Array.from(new Set(runs.map(r => r.period.slice(0, 4)))).sort().reverse(), [runs]);
  const [year, setYear] = useState<string>('');

  useEffect(() => { if (!runId && ordered[0]) setRunId(ordered[0].id); }, [ordered, runId]);
  useEffect(() => { if (!year && years[0]) setYear(years[0]); }, [years, year]);

  // Rekap setahun per karyawan (dasar bukti potong 1721-A1)
  const ytd = useMemo(() => {
    const m = new Map<string, { name: string; nip: string; npwp: string; months: number; gross: number; bpjs: number; pph: number }>();
    runs.filter(r => r.period.startsWith(year) && r.status !== 'draft').forEach(r => r.lines.forEach(l => {
      const cur = m.get(l.employeeId) ?? { name: l.name, nip: l.nip, npwp: l.npwp, months: 0, gross: 0, bpjs: 0, pph: 0 };
      cur.months += 1; cur.gross += l.computed.taxableGross; cur.bpjs += l.computed.eeJht + l.computed.eeJp; cur.pph += l.computed.pph21;
      m.set(l.employeeId, cur);
    }));
    return [...m.values()];
  }, [runs, year]);

  if (runs.length === 0) {
    return <div className="fin-card"><EmptyState icon={FileSpreadsheet} title="Belum ada data pajak & BPJS" description="Laporan PPh 21 dan BPJS muncul setelah kamu membuat payroll run." /></div>;
  }

  const run = ordered.find(r => r.id === runId) ?? ordered[0];
  const t = runTotals(run.lines);

  const tabs: { key: View; label: string }[] = [
    { key: 'pph21', label: 'PPh Pasal 21' },
    { key: 'bpjs', label: 'BPJS' },
    { key: 'ytd', label: 'Rekap Tahunan (1721-A1)' },
  ];

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          {tabs.map(x => (
            <button key={x.key} onClick={() => setView(x.key)}
              className={`px-3 py-1.5 text-[12px] font-medium rounded transition-colors ${view === x.key ? 'bg-card text-foreground card-shadow' : 'text-muted-foreground hover:text-foreground'}`}>
              {x.label}
            </button>
          ))}
        </div>
        {view !== 'ytd' ? (
          <select value={run.id} onChange={e => setRunId(e.target.value)} className="py-1.5 px-3 text-[12px] border border-border rounded-md bg-card">
            {ordered.map(r => <option key={r.id} value={r.id}>{periodLabel(r.period)}</option>)}
          </select>
        ) : (
          <select value={year} onChange={e => setYear(e.target.value)} className="py-1.5 px-3 text-[12px] border border-border rounded-md bg-card">
            {years.map(y => <option key={y}>{y}</option>)}
          </select>
        )}
      </div>

      {view === 'pph21' && (
        <SectionCard title={`PPh Pasal 21 — ${periodLabel(run.period)}`} subtitle={`Total dipotong ${rupiah(t.pph21)} • setor paling lambat tanggal 10 bulan berikutnya`}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-border bg-muted/40">{['Karyawan', 'NPWP', 'PTKP', 'Metode', 'Bruto Pajak', 'PPh 21'].map(c => <th key={c} className={TH}>{c}</th>)}</tr></thead>
              <tbody>
                {run.lines.map(l => (
                  <tr key={l.employeeId} className="border-b border-border hover:bg-muted/30">
                    <td className={`${TD} font-medium text-foreground`}>{l.name}</td>
                    <td className={`${TD} text-muted-foreground`}>{l.npwp || <span className="text-amber-600">Tidak ada (+20%)</span>}</td>
                    <td className={TD}>{l.ptkp}</td>
                    <td className={`${TD} text-muted-foreground`}>{l.computed.method === 'TER' ? `TER ${l.computed.terCategory} • ${l.computed.terRate}%` : 'Tahunan (Pasal 17)'}</td>
                    <td className={`${TD} financial-value`}>{rupiah(l.computed.taxableGross)}</td>
                    <td className={`${TD} financial-value font-semibold`}>{rupiah(l.computed.pph21)}</td>
                  </tr>
                ))}
                <tr className="bg-muted/40 font-semibold"><td className={TD} colSpan={4}>Total</td>
                  <td className={`${TD} financial-value`}>{rupiah(run.lines.reduce((s, l) => s + l.computed.taxableGross, 0))}</td>
                  <td className={`${TD} financial-value`}>{rupiah(t.pph21)}</td></tr>
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {view === 'bpjs' && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
            {[
              ['JHT', t.erJht + t.eeJht], ['JP', t.erJp + t.eeJp], ['JKK + JKM', t.erJkk + t.erJkm], ['BPJS Kesehatan', t.erKes + t.eeKes],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl border border-border bg-card p-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{k}</div>
                <div className="number-display font-bold text-[15px] text-foreground mt-1">{rupiah(v as number)}</div>
              </div>
            ))}
          </div>
          <SectionCard title={`Iuran BPJS — ${periodLabel(run.period)}`} subtitle={`Total ${rupiah(t.bpjsPayable)} (perusahaan ${rupiah(t.erTotal)} + karyawan ${rupiah(t.eeTotal)}) • bayar paling lambat tanggal 15`}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="border-b border-border bg-muted/40">
                  {['Karyawan', 'JHT (Pr / Kr)', 'JP (Pr / Kr)', 'JKK', 'JKM', 'Kesehatan (Pr / Kr)', 'Total'].map(c => <th key={c} className={TH}>{c}</th>)}
                </tr></thead>
                <tbody>
                  {run.lines.map(l => {
                    const c = l.computed;
                    return (
                      <tr key={l.employeeId} className="border-b border-border hover:bg-muted/30">
                        <td className={`${TD} font-medium text-foreground`}>{l.name}</td>
                        <td className={`${TD} financial-value`}>{rupiah(c.erJht)} / {rupiah(c.eeJht)}</td>
                        <td className={`${TD} financial-value`}>{rupiah(c.erJp)} / {rupiah(c.eeJp)}</td>
                        <td className={`${TD} financial-value`}>{rupiah(c.erJkk)}</td>
                        <td className={`${TD} financial-value`}>{rupiah(c.erJkm)}</td>
                        <td className={`${TD} financial-value`}>{rupiah(c.erKes)} / {rupiah(c.eeKes)}</td>
                        <td className={`${TD} financial-value font-semibold`}>{rupiah(c.erTotal + c.eeTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}

      {view === 'ytd' && (
        <SectionCard title={`Rekap Tahun ${year}`} subtitle="Akumulasi payroll yang sudah disetujui/dibayar — acuan penyusunan bukti potong 1721-A1">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-border bg-muted/40">{['Karyawan', 'NPWP', 'Masa', 'Bruto Pajak', 'Iuran Pensiun (JHT+JP)', 'PPh 21 Dipotong'].map(c => <th key={c} className={TH}>{c}</th>)}</tr></thead>
              <tbody>
                {ytd.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Belum ada payroll yang disetujui pada tahun ini.</td></tr>}
                {ytd.map(r => (
                  <tr key={r.nip} className="border-b border-border hover:bg-muted/30">
                    <td className={`${TD} font-medium text-foreground`}>{r.name}</td>
                    <td className={`${TD} text-muted-foreground`}>{r.npwp || '—'}</td>
                    <td className={TD}>{r.months} bln</td>
                    <td className={`${TD} financial-value`}>{rupiah(r.gross)}</td>
                    <td className={`${TD} financial-value`}>{rupiah(r.bpjs)}</td>
                    <td className={`${TD} financial-value font-semibold`}>{rupiah(r.pph)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </>
  );
}
