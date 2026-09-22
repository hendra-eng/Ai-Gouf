'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import Icon from '@/components/ui/AppIcon';
import StatusBadge from '@/components/ui/StatusBadge';
import { customers, invoices, arAgingData, formatRupiah, riskColors } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';
import InteractiveDonutChart, { DonutLivePreview } from '@/components/shared/InteractiveDonutChart';
import ARAgingChartInner from '@/app/accounts-receivable/components/ARAgingChartInner';

const CONC_COLORS = ['#DC2626', '#D97706', '#2563EB', '#16A34A', '#94A3B8'];

// [UBAH] Narasi & metrik yang sebelumnya hardcoded (Rp 1.24M, PT Mitra Solusi
// Digital, dst) sekarang dihitung dari data customers/invoices asli (kosong
// sampai client aktif punya jurnal AR) -- pola sama seperti APRiskAnalysis.tsx.
export default function ARRiskAnalysis() {
  const router = useRouter();
  const { fx } = useCurrency();

  const overdueCustomers = customers.filter((c) => c.overdueAR > 0).sort((a, b) => b.overdueAR - a.overdueAR);
  const overdueInvoices = invoices.filter((i) => i.status === 'Overdue').sort((a, b) => b.daysOverdue - a.daysOverdue);
  // ARAgingChartInner butuh fx yang menerima number (nilai rupiah mentah),
  // sedangkan fx dari useCurrency menerima string -- bungkus lewat formatRupiah.
  const fxAmount = (v: number) => fx(formatRupiah(v, true));

  // ── Aggregate metrics dari data customer/invoice yang sebenarnya ──
  const totalAR = customers.reduce((s, c) => s + c.totalAR, 0);
  const currentARTotal = customers.reduce((s, c) => s + c.currentAR, 0);
  const overdueARTotal = customers.reduce((s, c) => s + c.overdueAR, 0);
  const dueThisWeekTotal = arAgingData.find((b) => b.bucket === '1–30 Days')?.amount || 0;
  const over90Bucket = arAgingData.find((b) => b.bucket === '90+ Days')?.amount || 0;
  const dso = customers.length > 0 ? Math.round(customers.reduce((s, c) => s + c.dso, 0) / customers.length) : 0;
  const onTimeCustomerCount = customers.filter((c) => c.riskLevel !== 'Critical' && c.riskLevel !== 'High').length;
  const collectionRate = customers.length > 0 ? Math.round((onTimeCustomerCount / customers.length) * 1000) / 10 : 0;
  const overduePct = totalAR > 0 ? Math.round((overdueARTotal / totalAR) * 1000) / 10 : 0;
  const badDebtExposure = customers.reduce((s, c) => s + c.ar90Plus, 0);
  const topRiskCustomer = overdueCustomers[0];
  const secondInvoice = overdueInvoices.find((i) => i.customerId !== topRiskCustomer?.id);

  const [activeConcAR, setActiveConcAR] = useState<number | null>(null);
  const [concARLivePreview, setConcARLivePreview] = useState<DonutLivePreview[] | null>(null);
  const concentrationCustomers = customers.slice(0, 5);
  const concTotal = concentrationCustomers.reduce((s, c) => s + c.totalAR, 0);
  const customerConcentration = concentrationCustomers.map((c, i) => ({
    name: c.name.replace('PT ', '').replace('CV ', ''),
    value: c.totalAR,
    color: CONC_COLORS[i % CONC_COLORS.length],
  }));
  const top3Pct = concTotal > 0 ? (concentrationCustomers.slice(0, 3).reduce((s, c) => s + c.totalAR, 0) / concTotal) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Executive Summary */}
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="DocumentTextIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-semibold text-foreground">Executive Summary</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Total AR berada di <strong>{fx(formatRupiah(totalAR, true))}</strong> dengan <strong>{fx(formatRupiah(overdueARTotal, true))} ({overduePct}%) overdue</strong>.
          DSO (Days Sales Outstanding) saat ini {dso} hari, dengan tingkat penagihan tepat waktu {collectionRate}% dari total customer aktif.
          {topRiskCustomer && (
            <> Risiko terkonsentrasi pada customer <strong>{topRiskCustomer.name}</strong> ({fx(formatRupiah(topRiskCustomer.overdueAR, true))}, risk level {topRiskCustomer.riskLevel}).</>
          )}
          {secondInvoice && (
            <> Invoice {secondInvoice.number} dari {secondInvoice.customerName} ({fx(formatRupiah(secondInvoice.outstanding, true))}) juga sudah {secondInvoice.daysOverdue} hari terlambat.</>
          )}
          {' '}Segera tindak lanjuti penagihan pada akun kritis untuk menjaga arus kas dan hubungan dengan customer.
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total AR', value: formatRupiah(totalAR, true), color: 'text-foreground', bg: 'bg-card' },
          { label: 'Overdue AR', value: formatRupiah(overdueARTotal, true), color: 'text-danger', bg: 'bg-danger-bg' },
          { label: '90+ Days', value: formatRupiah(over90Bucket, true), color: 'text-danger', bg: 'bg-danger-bg' },
          { label: 'DSO', value: `${dso} days`, color: 'text-warning', bg: 'bg-warning-bg' },
          { label: 'Collection Rate', value: `${collectionRate}%`, color: 'text-warning', bg: 'bg-warning-bg' },
          { label: 'Bad Debt Exposure', value: formatRupiah(badDebtExposure, true), color: 'text-danger', bg: 'bg-danger-bg' },
          { label: 'Current AR', value: formatRupiah(currentARTotal, true), color: 'text-success', bg: 'bg-success-bg' },
          { label: 'Due This Week', value: formatRupiah(dueThisWeekTotal, true), color: 'text-info', bg: 'bg-info-bg' },
        ].map((m) => (
          <div key={`arm-${m.label}`} className={`${m.bg} border border-border rounded-lg p-3`}>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
            <p className={`text-xl font-bold tabular-nums ${m.color}`}>{m.label.includes('DSO') || m.label.includes('Rate') ? m.value : fx(m.value)}</p>
          </div>
        ))}
      </div>

      {/* AR Aging Chart */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card-elevated-md rounded-xl p-5">
          <h3 className="text-md font-semibold text-foreground mb-4">AR Aging Distribution</h3>
          <ARAgingChartInner data={arAgingData} fx={fxAmount} />
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h3 className="text-md font-semibold text-foreground mb-4">Customer Concentration Risk</h3>
          <div className="flex justify-center">
            <InteractiveDonutChart
              data={customerConcentration}
              height={180}
              rawValue
              activeIndex={activeConcAR}
              onActiveChange={setActiveConcAR}
              onLiveChange={setConcARLivePreview}
            />
          </div>
          <div className="space-y-1.5 mt-2">
            {customerConcentration.map((c, i) => {
              const preview = concARLivePreview?.[i];
              const displayPct = preview ? preview.pct : concTotal > 0 ? (c.value / concTotal) * 100 : 0;
              return (
                <div
                  key={`conc-ar-leg-${i}`}
                  onClick={() => setActiveConcAR((prev) => (prev === i ? null : i))}
                  className={`flex items-center justify-between text-xs cursor-pointer rounded-md px-1 py-0.5 transition-colors ${
                    activeConcAR === i ? 'bg-secondary' : 'hover:bg-secondary/50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                    <span className={`truncate ${activeConcAR === i ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>{c.name}</span>
                  </div>
                  <span className="font-semibold text-foreground ml-2 flex-shrink-0">{displayPct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-center text-muted-foreground mt-2">Top 3 customers = {top3Pct.toFixed(1)}% dari total AR</p>
        </div>
      </div>

      {/* High Risk Customers */}
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-md font-semibold text-foreground">High Risk Customer Analysis</h3>
          <button onClick={() => router.push('/accounts-receivable')} className="text-xs text-primary hover:underline font-medium">View All →</button>
        </div>
        <div className="space-y-3">
          {overdueCustomers.slice(0, 4).map((c) => (
            <div key={`ar-risk-cust-${c.id}`} className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-secondary/50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                  <StatusBadge label={c.riskLevel} className={riskColors[c.riskLevel]} />
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Overdue: <strong className="text-danger">{fx(formatRupiah(c.overdueAR, true))}</strong></span>
                  <span>DSO: <strong className="text-warning">{c.dso}d</strong></span>
                  <span>Collection: <strong>{c.collectionRate}%</strong></span>
                </div>
              </div>
              <button
                onClick={() => router.push('/accounts-receivable')}
                className="text-xs text-primary hover:underline font-medium flex-shrink-0"
              >
                Collect →
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Overdue Invoices */}
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-md font-semibold text-foreground">Critical Overdue Invoices</h3>
          <button onClick={() => router.push('/accounts-receivable')} className="text-xs text-primary hover:underline font-medium">View All Invoices →</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Invoice', 'Customer', 'Amount', 'Days Overdue', 'Risk'].map((h) => (
                  <th key={`arri-${h}`} className="pb-2 text-left text-2xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overdueInvoices.slice(0, 5).map((inv) => (
                <tr key={inv.id} className="border-b border-border hover:bg-secondary/40 transition-colors">
                  <td className="py-2.5 font-medium text-primary">{inv.number}</td>
                  <td className="py-2.5 text-foreground">{inv.customerName}</td>
                  <td className="py-2.5 tabular-nums font-semibold">{fx(formatRupiah(inv.outstanding, true))}</td>
                  <td className="py-2.5">
                    <span className={`font-semibold ${inv.daysOverdue > 60 ? 'text-danger' : 'text-warning'}`}>{inv.daysOverdue}d</span>
                  </td>
                  <td className="py-2.5">
                    <StatusBadge
                      label={inv.priority}
                      className={inv.priority === 'Critical' ? 'bg-danger-bg text-danger-foreground' : 'bg-orange-50 text-orange-700'}
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
            topRiskCustomer && {
              priority: 'Critical',
              title: `Prioritaskan penagihan ke ${topRiskCustomer.name}`,
              desc: `${formatRupiah(topRiskCustomer.overdueAR, true)} sudah overdue dengan risk level ${topRiskCustomer.riskLevel}. Hubungi segera dan pertimbangkan penangguhan kredit sampai pembayaran diterima.`,
              action: 'View Customer',
              route: '/accounts-receivable',
            },
            secondInvoice && {
              priority: 'High',
              title: `Tindak lanjuti invoice ${secondInvoice.number}`,
              desc: `${formatRupiah(secondInvoice.outstanding, true)} dari ${secondInvoice.customerName} sudah ${secondInvoice.daysOverdue} hari terlambat. Jadwalkan follow-up dan tawarkan rencana pembayaran bila perlu.`,
              action: 'View Invoice',
              route: '/accounts-receivable',
            },
            {
              priority: 'Medium',
              title: 'Review Provisi Piutang Tak Tertagih',
              desc: `Eksposur sebesar ${formatRupiah(badDebtExposure, true)} pada bucket 90+ hari memerlukan review provisi. Konsultasikan dengan auditor untuk menentukan tingkat provisi yang sesuai.`,
              action: 'View Report',
              route: '/reports',
            },
          ].filter(Boolean).map((rec: any) => (
            <div key={`ar-rec-${rec.title}`} className="flex items-start gap-3 p-3 border border-border rounded-lg">
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