'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import Icon from '@/components/ui/AppIcon';
import StatusBadge from '@/components/ui/StatusBadge';
import { vendors, bills, apAgingData, formatRupiah, riskColors } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';
import InteractiveDonutChart, { DonutLivePreview } from '@/components/shared/InteractiveDonutChart';

const CONC_COLORS = ['#DC2626', '#D97706', '#2563EB', '#16A34A', '#94A3B8'];

const CustomTooltip = ({ active, payload, label }: any) => {
  const { fx } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={`aptt-${i}`} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.fill || p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold">{typeof p.value === 'number' && p.value > 1000 ? fx(`Rp ${(p.value / 1000000).toFixed(0)}Jt`) : `${p.value}%`}</span>
        </div>
      ))}
    </div>
  );
};

export default function APRiskAnalysis() {
  const router = useRouter();
  const { fx } = useCurrency();

  const overdueVendors = vendors.filter((v) => v.overdueAP > 0).sort((a, b) => b.overdueAP - a.overdueAP);
  const overdueBills = bills.filter((b) => b.status === 'Overdue').sort((a, b) => b.daysOverdue - a.daysOverdue);

  // ── Aggregate metrics dari data vendor/bills yang sebenarnya ──
  const totalAP = vendors.reduce((s, v) => s + v.totalAP, 0);
  const currentAPTotal = vendors.reduce((s, v) => s + v.currentAP, 0);
  const overdueAPTotal = vendors.reduce((s, v) => s + v.overdueAP, 0);
  const dueSoonTotal = vendors.reduce((s, v) => s + v.dueSoon, 0);
  const over90Bucket = apAgingData.find((b) => b.bucket === '90+ Days')?.amount || 0;
  const dpo = Math.round(vendors.reduce((s, v) => s + v.avgPaymentDays, 0) / vendors.length);
  const onTimeVendorCount = vendors.filter((v) => v.status !== 'Overdue').length;
  const onTimeRate = Math.round((onTimeVendorCount / vendors.length) * 1000) / 10;
  const overduePct = totalAP > 0 ? Math.round((overdueAPTotal / totalAP) * 1000) / 10 : 0;
  const topRiskVendor = overdueVendors[0];
  const secondBill = overdueBills.find((b) => b.vendorId !== topRiskVendor?.id);

  const [activeConcAP, setActiveConcAP] = useState<number | null>(null);
  const [concAPLivePreview, setConcAPLivePreview] = useState<DonutLivePreview[] | null>(null);
  const concentrationVendors = vendors.slice(0, 5);
  const concTotal = concentrationVendors.reduce((s, v) => s + v.totalAP, 0);
  const vendorConcentration = concentrationVendors.map((v, i) => ({
    name: v.name.replace('PT ', '').replace('CV ', '').replace('UD ', ''),
    value: v.totalAP,
    color: CONC_COLORS[i % CONC_COLORS.length],
  }));
  const top3Pct = concTotal > 0 ? (concentrationVendors.slice(0, 3).reduce((s, v) => s + v.totalAP, 0) / concTotal) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Executive Summary */}
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="DocumentTextIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-semibold text-foreground">Executive Summary</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Total AP berada di <strong>{fx(formatRupiah(totalAP, true))}</strong> dengan <strong>{fx(formatRupiah(overdueAPTotal, true))} ({overduePct}%) overdue</strong>.
          DPO (Days Payable Outstanding) saat ini {dpo} hari, dengan tingkat pembayaran tepat waktu {onTimeRate}% dari total vendor aktif.
          {topRiskVendor && (
            <> Risiko terkonsentrasi pada vendor <strong>{topRiskVendor.name}</strong> ({fx(formatRupiah(topRiskVendor.overdueAP, true))}, risk level {topRiskVendor.riskLevel}).</>
          )}
          {secondBill && (
            <> Tagihan {secondBill.number} dari {secondBill.vendorName} ({fx(formatRupiah(secondBill.outstanding, true))}) juga sudah {secondBill.daysOverdue} hari terlambat.</>
          )}
          {' '}Segera tindak lanjuti pembayaran pada akun kritis untuk menjaga hubungan dan syarat pembayaran dengan vendor.
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total AP', value: formatRupiah(totalAP, true), color: 'text-foreground', bg: 'bg-card' },
          { label: 'Overdue AP', value: formatRupiah(overdueAPTotal, true), color: 'text-danger', bg: 'bg-danger-bg' },
          { label: '90+ Days', value: formatRupiah(over90Bucket, true), color: 'text-danger', bg: 'bg-danger-bg' },
          { label: 'DPO', value: `${dpo} days`, color: 'text-warning', bg: 'bg-warning-bg' },
          { label: 'On-Time Payment Rate', value: `${onTimeRate}%`, color: 'text-warning', bg: 'bg-warning-bg' },
          { label: 'Payment Risk Exposure', value: formatRupiah(overdueAPTotal, true), color: 'text-danger', bg: 'bg-danger-bg' },
          { label: 'Current AP', value: formatRupiah(currentAPTotal, true), color: 'text-success', bg: 'bg-success-bg' },
          { label: 'Due Soon', value: formatRupiah(dueSoonTotal, true), color: 'text-info', bg: 'bg-info-bg' },
        ].map((m) => (
          <div key={`apm-${m.label}`} className={`${m.bg} border border-border rounded-lg p-3`}>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
            <p className={`text-xl font-bold tabular-nums ${m.color}`}>{m.label.includes('DPO') || m.label.includes('Rate') ? m.value : fx(m.value)}</p>
          </div>
        ))}
      </div>

      {/* AP Aging Chart */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card-elevated-md rounded-xl p-5">
          <h3 className="text-md font-semibold text-foreground mb-4">AP Aging Distribution</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={apAgingData} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `${(v / 1000000).toFixed(0)}Jt`} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={42} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="amount" name="Amount" radius={[3, 3, 0, 0]}>
                {apAgingData.map((entry, index) => (
                  <Cell key={`ap-age-cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h3 className="text-md font-semibold text-foreground mb-4">Vendor Concentration Risk</h3>
          <div className="flex justify-center">
            <InteractiveDonutChart
              data={vendorConcentration}
              height={180}
              rawValue
              activeIndex={activeConcAP}
              onActiveChange={setActiveConcAP}
              onLiveChange={setConcAPLivePreview}
            />
          </div>
          <div className="space-y-1.5 mt-2">
            {vendorConcentration.map((v, i) => {
              const preview = concAPLivePreview?.[i];
              const displayPct = preview ? preview.pct : concTotal > 0 ? (v.value / concTotal) * 100 : 0;
              return (
                <div
                  key={`conc-ap-leg-${i}`}
                  onClick={() => setActiveConcAP((prev) => (prev === i ? null : i))}
                  className={`flex items-center justify-between text-xs cursor-pointer rounded-md px-1 py-0.5 transition-colors ${
                    activeConcAP === i ? 'bg-secondary' : 'hover:bg-secondary/50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: v.color }} />
                    <span className={`truncate ${activeConcAP === i ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>{v.name}</span>
                  </div>
                  <span className="font-semibold text-foreground ml-2 flex-shrink-0">{displayPct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-center text-muted-foreground mt-2">Top 3 vendor = {top3Pct.toFixed(1)}% dari total AP</p>
        </div>
      </div>

      {/* High Risk Vendors */}
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-md font-semibold text-foreground">High Risk Vendor Analysis</h3>
          <button onClick={() => router.push('/accounts-payable')} className="text-xs text-primary hover:underline font-medium">View All →</button>
        </div>
        <div className="space-y-3">
          {vendors
            .slice()
            .sort((a, b) => (b.overdueAP + b.dueSoon) - (a.overdueAP + a.dueSoon))
            .slice(0, 4)
            .map((v) => (
              <div key={`ap-risk-vend-${v.id}`} className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-secondary/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-foreground truncate">{v.name}</p>
                    <StatusBadge label={v.riskLevel} className={riskColors[v.riskLevel]} />
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Overdue: <strong className="text-danger">{fx(formatRupiah(v.overdueAP, true))}</strong></span>
                    <span>Avg Payment: <strong className="text-warning">{v.avgPaymentDays}d</strong></span>
                    <span>Terms: <strong>{v.paymentTerms}</strong></span>
                  </div>
                </div>
                <button
                  onClick={() => router.push('/accounts-payable')}
                  className="text-xs text-primary hover:underline font-medium flex-shrink-0"
                >
                  Pay →
                </button>
              </div>
            ))}
        </div>
      </div>

      {/* Overdue Bills */}
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-md font-semibold text-foreground">Critical Overdue Bills</h3>
          <button onClick={() => router.push('/accounts-payable')} className="text-xs text-primary hover:underline font-medium">View All Bills →</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Bill', 'Vendor', 'Amount', 'Days Overdue', 'Risk'].map((h) => (
                  <th key={`apri-${h}`} className="pb-2 text-left text-2xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overdueBills.slice(0, 5).map((b) => (
                <tr key={b.id} className="border-b border-border hover:bg-secondary/40 transition-colors">
                  <td className="py-2.5 font-medium text-primary">{b.number}</td>
                  <td className="py-2.5 text-foreground">{b.vendorName}</td>
                  <td className="py-2.5 tabular-nums font-semibold">{fx(formatRupiah(b.outstanding, true))}</td>
                  <td className="py-2.5">
                    <span className={`font-semibold ${b.daysOverdue > 60 ? 'text-danger' : 'text-warning'}`}>{b.daysOverdue}d</span>
                  </td>
                  <td className="py-2.5">
                    <StatusBadge
                      label={b.priority}
                      className={b.priority === 'Critical' ? 'bg-danger-bg text-danger-foreground' : 'bg-orange-50 text-orange-700'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recommendations */}
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="LightBulbIcon" size={16} className="text-warning" />
          <h3 className="text-md font-semibold text-foreground">AI Recommendations</h3>
        </div>
        <div className="space-y-3">
          {[
            topRiskVendor && {
              priority: 'Critical',
              title: `Prioritaskan pembayaran ke ${topRiskVendor.name}`,
              desc: `${formatRupiah(topRiskVendor.overdueAP, true)} sudah overdue dengan risk level ${topRiskVendor.riskLevel}. Jadwalkan pembayaran segera untuk menjaga hubungan vendor dan syarat kredit (${topRiskVendor.paymentTerms}).`,
              action: 'View Vendor',
              route: '/accounts-payable',
            },
            secondBill && {
              priority: 'High',
              title: `Tindak lanjuti tagihan ${secondBill.number}`,
              desc: `${formatRupiah(secondBill.outstanding, true)} dari ${secondBill.vendorName} sudah ${secondBill.daysOverdue} hari terlambat. Verifikasi status approval dan proses pembayaran.`,
              action: 'View Bill',
              route: '/accounts-payable',
            },
            {
              priority: 'Medium',
              title: 'Review DPO terhadap target',
              desc: `DPO saat ini ${dpo} hari dengan ${formatRupiah(over90Bucket, true)} berada di bucket 90+ hari. Evaluasi kembali prioritas pembayaran vendor untuk menjaga cash flow tanpa merusak hubungan vendor.`,
              action: 'View Report',
              route: '/reports',
            },
          ].filter(Boolean).map((rec: any) => (
            <div key={`ap-rec-${rec.title}`} className="flex items-start gap-3 p-3 border border-border rounded-lg">
              <span className={`text-2xs px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 mt-0.5 ${
                rec.priority === 'Critical' ? 'bg-danger-bg text-danger-foreground' :
                rec.priority === 'High'? 'bg-orange-50 text-orange-700' : 'bg-warning-bg text-warning-foreground'
              }`}>{rec.priority}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{rec.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{fx(rec.desc)}</p>
              </div>
              <button onClick={() => router.push(rec.route)} className="text-xs text-primary hover:underline font-medium flex-shrink-0 whitespace-nowrap">
                {rec.action} →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}