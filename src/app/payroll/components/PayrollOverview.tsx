'use client';
import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { AlertTriangle, CalendarClock, CheckCircle2, Users } from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import EmptyState from '@/components/ui/EmptyState';
import { SectionCard } from './payrollUi';
import { periodLabel, type PayrollStore } from '../lib/payrollStore';
import { runTotals } from '../lib/payrollCalc';
import { rupiah } from '../lib/payrollExport';

const TrendChart = dynamic(() => import('./PayrollCharts').then(m => m.TrendChart), { ssr: false });
const DepartmentChart = dynamic(() => import('./PayrollCharts').then(m => m.DepartmentChart), { ssr: false });

const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `Rp ${(a / 1e9).toFixed(2).replace('.', ',')}M`;
  if (a >= 1e6) return `Rp ${(a / 1e6).toFixed(1).replace('.', ',')}Jt`;
  return `Rp ${Math.round(a).toLocaleString('id-ID')}`;
};

function pct(now: number, prev: number | undefined) {
  if (!prev) return undefined;
  return ((now - prev) / prev) * 100;
}

/** Tenggat kewajiban bulan berikutnya setelah masa gaji. */
function deadlines(period: string) {
  const [y, m] = period.split('-').map(Number);
  const nx = new Date(y, m, 1); // bulan berikutnya
  const mk = (day: number) => new Date(nx.getFullYear(), nx.getMonth(), day);
  return [
    { label: 'Setor PPh Pasal 21', date: mk(10), hint: 'Tanggal 10 bulan berikutnya' },
    { label: 'Iuran BPJS Kesehatan & Ketenagakerjaan', date: mk(15), hint: 'Tanggal 15 bulan berikutnya' },
    { label: 'Lapor SPT Masa PPh 21/26', date: mk(20), hint: 'Tanggal 20 bulan berikutnya' },
  ];
}

export default function PayrollOverview({ store, goTo }: { store: PayrollStore; goTo: (tab: string) => void }) {
  const { employees, runs } = store;
  const active = employees.filter(e => e.active);
  const latest = runs.length ? runs[runs.length - 1] : null;
  const prev = runs.length > 1 ? runs[runs.length - 2] : null;
  const t = useMemo(() => (latest ? runTotals(latest.lines) : null), [latest]);
  const tp = useMemo(() => (prev ? runTotals(prev.lines) : null), [prev]);

  const trend = useMemo(() => runs.slice(-6).map(r => {
    const x = runTotals(r.lines);
    return { label: periodLabel(r.period).replace(/ \d{4}$/, ''), gross: x.grossCash, cost: x.companyCost };
  }), [runs]);

  const dept = useMemo(() => {
    if (!latest) return [];
    const m = new Map<string, number>();
    latest.lines.forEach(l => m.set(l.department || 'Lainnya', (m.get(l.department || 'Lainnya') || 0) + l.computed.companyCost));
    return [...m.entries()].map(([name, cost]) => ({ name, cost })).sort((a, b) => b.cost - a.cost);
  }, [latest]);

  const alerts = useMemo(() => {
    const out: { text: string; tab: string }[] = [];
    const noNpwp = active.filter(e => !e.npwp.trim()).length;
    const noBank = active.filter(e => !e.bankAccount.trim()).length;
    const noBpjs = active.filter(e => !e.bpjsTk || !e.bpjsKes).length;
    if (noNpwp) out.push({ text: `${noNpwp} karyawan belum punya NPWP — PPh 21 dikenai tarif +20%.`, tab: 'employees' });
    if (noBank) out.push({ text: `${noBank} karyawan belum punya nomor rekening untuk transfer gaji.`, tab: 'employees' });
    if (noBpjs) out.push({ text: `${noBpjs} karyawan belum terdaftar penuh di BPJS (TK / Kesehatan).`, tab: 'employees' });
    runs.filter(r => r.status === 'draft').forEach(r => out.push({ text: `Payroll ${periodLabel(r.period)} masih draft — belum disetujui.`, tab: 'runs' }));
    runs.filter(r => r.status === 'approved').forEach(r => out.push({ text: `Payroll ${periodLabel(r.period)} sudah disetujui tetapi belum ditandai dibayar.`, tab: 'runs' }));
    return out;
  }, [active, runs]);

  if (employees.length === 0) {
    return (
      <div className="fin-card">
        <EmptyState
          icon={Users}
          title="Belum ada data karyawan"
          description="Tambahkan karyawan terlebih dahulu, lalu buat payroll run pertama. Kamu juga bisa memuat 4 karyawan contoh untuk mencoba alurnya."
          action={{ label: 'Tambah karyawan', onClick: () => goTo('employees') }}
        />
        <div className="text-center pb-8 -mt-8">
          <button onClick={store.loadSample} className="fin-btn-secondary">Muat data contoh</button>
        </div>
      </div>
    );
  }

  const due = latest ? deadlines(latest.period) : [];
  const today = new Date();

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KpiCard
          title="Karyawan Aktif" value={String(active.length)} icon="UsersIcon" iconBg="bg-blue-50" iconColor="text-blue-600"
          subLabel={`${employees.length - active.length} nonaktif`} changeNeutral change={latest ? `${latest.lines.length} di payroll terakhir` : undefined}
        />
        <KpiCard
          title="Gaji Bruto" value={t ? compact(t.grossCash) : '—'} icon="BanknotesIcon" iconBg="bg-green-50" iconColor="text-green-600"
          subLabel={latest ? periodLabel(latest.period) : 'Belum ada payroll run'}
          change={t && tp ? pct(t.grossCash, tp.grossCash) : undefined} changeLabel="vs bulan lalu"
        />
        <KpiCard
          title="Take Home Pay" value={t ? compact(t.netPay) : '—'} icon="CreditCardIcon" iconBg="bg-emerald-50" iconColor="text-emerald-600"
          subLabel="Total transfer ke karyawan"
          change={t && tp ? pct(t.netPay, tp.netPay) : undefined} changeLabel="vs bulan lalu"
        />
        <KpiCard
          title="Kewajiban Pajak & BPJS" value={t ? compact(t.pph21 + t.bpjsPayable) : '—'} icon="ReceiptPercentIcon" iconBg="bg-amber-50" iconColor="text-amber-600"
          subLabel={t ? `PPh 21 ${compact(t.pph21)} • BPJS ${compact(t.bpjsPayable)}` : 'Setor setelah payroll dibayar'}
          changeNeutral change={undefined}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
        <div className="fin-card xl:col-span-2">
          <div className="p-5 border-b border-border">
            <div className="text-[14px] font-semibold text-foreground">Tren Biaya Payroll</div>
            <div className="text-[11px] text-muted-foreground">Gaji bruto vs total biaya perusahaan (termasuk BPJS porsi perusahaan), 6 periode terakhir</div>
          </div>
          <div className="p-5">
            {trend.length ? <TrendChart data={trend} /> : <p className="text-sm text-muted-foreground py-10 text-center">Belum ada payroll run.</p>}
          </div>
        </div>

        <div className="fin-card">
          <div className="p-5 border-b border-border">
            <div className="text-[14px] font-semibold text-foreground">Biaya per Departemen</div>
            <div className="text-[11px] text-muted-foreground">{latest ? periodLabel(latest.period) : 'Payroll terakhir'}</div>
          </div>
          <div className="p-5">
            {dept.length ? <DepartmentChart data={dept} /> : <p className="text-sm text-muted-foreground py-10 text-center">Belum ada data.</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SectionCard title="Perlu Perhatian" subtitle="Hal yang sebaiknya dibereskan sebelum payroll berikutnya" className="!mb-0">
          <div className="p-5 space-y-2">
            {alerts.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-positive"><CheckCircle2 size={16} /> Semua data karyawan dan payroll sudah rapi.</div>
            )}
            {alerts.map((a, i) => (
              <button
                key={`alert-${i}`} onClick={() => goTo(a.tab)}
                className="w-full text-left flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 hover:bg-amber-100 transition-colors"
              >
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> {a.text}
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Kalender Kepatuhan" subtitle={latest ? `Untuk masa gaji ${periodLabel(latest.period)}` : 'Muncul setelah ada payroll run'} className="!mb-0">
          <div className="p-5 space-y-3">
            {due.length === 0 && <p className="text-sm text-muted-foreground">Belum ada payroll run.</p>}
            {due.map(d => {
              const days = Math.ceil((d.date.getTime() - today.getTime()) / 86400000);
              const variant = days < 0 ? 'badge-neutral' : days <= 5 ? 'badge-warning' : 'badge-info';
              return (
                <div key={d.label} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0"><CalendarClock size={16} className="text-muted-foreground" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-foreground">{d.label}</div>
                    <div className="text-[11px] text-muted-foreground">{d.hint} — {d.date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                  </div>
                  <span className={variant}>{days < 0 ? 'Lewat' : days === 0 ? 'Hari ini' : `${days} hari lagi`}</span>
                </div>
              );
            })}
            {latest && t && (
              <div className="text-[11px] text-muted-foreground pt-2 border-t border-border">
                Estimasi setor: PPh 21 {rupiah(t.pph21)} • BPJS {rupiah(t.bpjsPayable)}
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
