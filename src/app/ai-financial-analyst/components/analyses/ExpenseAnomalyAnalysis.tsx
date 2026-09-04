'use client';
import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';
import { formatRupiah } from '@/lib/mockData';
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import type { Transaction } from '@/app/transactions/components/transactionData';

// [BARU] Sambungkan ke data ASLI -- sebelumnya modul ini pakai 5 anomali
// hardcoded. Sekarang anomali dihitung langsung dari transaksi kelompok
// Expense (sumber tunggal: TransactionsContext, yang sendirinya sudah
// tersambung ke backend jurnal-posting client aktif, fallback ke
// ALL_TRANSACTIONS kalau belum ada client aktif).
//
// Metodologi deteksi: untuk tiap transaksi Expense, "expected" dihitung dari
// rata-rata transaksi LAIN di kategori yang sama (peer group per `category`)
// -- bukan angka budget statis, karena app ini belum punya modul Budget yang
// expose data terstruktur (lihat catatan yang sama di useProfitLossData.ts).
// Kategori dengan <2 transaksi dilewati (belum ada baseline pembanding).
// Transaksi yang variance-nya |%| di bawah ambang batas dianggap normal.

type RiskLevel = 'High' | 'Medium' | 'Low';

interface ExpenseAnomaly {
  id: string;
  account: string;
  category: string;
  vendor: string;
  date: string;
  amount: number;
  expected: number;
  variance: number;
  variancePct: number;
  peerCount: number;
  risk: RiskLevel;
}

const ANOMALY_THRESHOLD_PCT = 20;

function riskFromAbsPct(absPct: number): RiskLevel {
  if (absPct >= 80) return 'High';
  if (absPct >= 35) return 'Medium';
  return 'Low';
}

function detectExpenseAnomalies(expenseTx: Transaction[]): ExpenseAnomaly[] {
  const byCategory = new Map<string, Transaction[]>();
  expenseTx.forEach((tx) => {
    if (!tx.debit) return;
    const list = byCategory.get(tx.category) || [];
    list.push(tx);
    byCategory.set(tx.category, list);
  });

  const results: ExpenseAnomaly[] = [];
  byCategory.forEach((txs, category) => {
    if (txs.length < 2) return; // belum ada baseline pembanding di kategori ini
    txs.forEach((tx) => {
      const peers = txs.filter((t) => t.id !== tx.id);
      const expected = peers.reduce((s, t) => s + (t.debit || 0), 0) / peers.length;
      if (expected <= 0) return;
      const variance = (tx.debit || 0) - expected;
      const variancePct = (variance / expected) * 100;
      if (Math.abs(variancePct) < ANOMALY_THRESHOLD_PCT) return;
      results.push({
        id: tx.id,
        account: tx.accountName,
        category,
        vendor: tx.party || 'Tidak Diketahui',
        date: tx.date,
        amount: tx.debit || 0,
        expected,
        variance,
        variancePct,
        peerCount: peers.length,
        risk: riskFromAbsPct(Math.abs(variancePct)),
      });
    });
  });

  return results.sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct));
}

export default function ExpenseAnomalyAnalysis() {
  const router = useRouter();
  const { fx } = useCurrency();
  const { transactions, getByGroup, loading } = useTransactions();

  const expenseTx = useMemo(() => getByGroup('expense'), [transactions, getByGroup]);
  const anomalies = useMemo(() => detectExpenseAnomalies(expenseTx), [expenseTx]);

  const totalExpense = useMemo(() => expenseTx.reduce((s, t) => s + (t.debit || 0), 0), [expenseTx]);
  const overspend = anomalies.filter((a) => a.variance > 0);
  const totalVariance = overspend.reduce((s, a) => s + a.variance, 0);
  const highRiskCount = anomalies.filter((a) => a.risk === 'High').length;
  const variancePctOfTotal = totalExpense > 0 ? (totalVariance / totalExpense) * 100 : 0;
  const topAnomaly = anomalies[0];

  if (loading) {
    return (
      <div className="card-elevated-md rounded-xl p-8 text-center text-sm text-muted-foreground">
        Memuat data transaksi Expense…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="DocumentTextIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-semibold text-foreground">Executive Summary</h3>
        </div>
        {anomalies.length === 0 ? (
          <p className="text-sm text-foreground/80 leading-relaxed">
            Tidak ada anomali pengeluaran yang terdeteksi dari {expenseTx.length} transaksi Expense saat ini —
            seluruh kategori masih berada dalam rentang normal dibanding rata-rata historisnya masing-masing.
          </p>
        ) : (
          <p className="text-sm text-foreground/80 leading-relaxed">
            AI mendeteksi <strong>{anomalies.length} anomali pengeluaran</strong> dengan total varians{' '}
            <strong>{fx(formatRupiah(totalVariance, true))} di atas ekspektasi</strong>.
            {topAnomaly && (
              <>
                {' '}Yang paling signifikan ada di <strong>{topAnomaly.account}</strong> ({topAnomaly.vendor}) sebesar{' '}
                {topAnomaly.variancePct > 0 ? '+' : ''}
                {topAnomaly.variancePct.toFixed(1)}% dibanding rata-rata kategori {topAnomaly.category}.
              </>
            )}{' '}
            Kombinasi anomali ini setara <strong>{variancePctOfTotal.toFixed(1)}% dari total beban operasional</strong> yang
            tercatat dan perlu ditinjau manajemen.
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Anomalies Detected', value: String(anomalies.length), color: 'text-foreground', bg: 'bg-card' },
          { label: 'Total Variance', value: fx(formatRupiah(totalVariance, true)), color: 'text-danger', bg: 'bg-danger-bg' },
          { label: 'High Risk Items', value: String(highRiskCount), color: 'text-danger', bg: 'bg-danger-bg' },
        ].map((m) => (
          <div key={`anom-m-${m.label}`} className={`${m.bg} border border-border rounded-lg p-4`}>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{m.label}</p>
            <p className={`text-3xl font-bold tabular-nums ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      <div className="card-elevated-md rounded-xl p-5">
        <h3 className="text-md font-semibold text-foreground mb-4">Detected Anomalies</h3>
        {anomalies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Belum cukup data historis per kategori, atau tidak ada penyimpangan signifikan (≥ {ANOMALY_THRESHOLD_PCT}%) untuk ditampilkan.
          </p>
        ) : (
          <div className="space-y-3">
            {anomalies.slice(0, 8).map((anom) => {
              const barBase = Math.max(anom.amount, anom.expected) || 1;
              const expectedPct = Math.min(100, (anom.expected / barBase) * 100);
              return (
                <div
                  key={anom.id}
                  className={`border rounded-lg p-4 ${
                    anom.risk === 'High' ? 'border-danger/30 bg-danger-bg/20' :
                    anom.risk === 'Medium' ? 'border-warning/30 bg-warning-bg/20' : 'border-border bg-secondary/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-semibold text-foreground">{anom.account}</p>
                        <span className={`text-2xs px-1.5 py-0.5 rounded-full font-semibold ${
                          anom.risk === 'High' ? 'bg-danger-bg text-danger-foreground' :
                          anom.risk === 'Medium' ? 'bg-warning-bg text-warning-foreground' :
                          'bg-secondary text-muted-foreground'
                        }`}>{anom.risk} Risk</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{anom.vendor} · {anom.category} · {anom.date}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold tabular-nums text-foreground">{fx(formatRupiah(anom.amount, true))}</p>
                      <p className={`text-xs font-semibold ${anom.variance > 0 ? (anom.risk === 'High' ? 'text-danger' : 'text-warning') : 'text-info'}`}>
                        {anom.variance > 0 ? '+' : ''}{fx(formatRupiah(anom.variance, true))} ({anom.variancePct > 0 ? '+' : ''}{anom.variancePct.toFixed(1)}%)
                      </p>
                    </div>
                  </div>

                  {/* Expected vs Actual bar */}
                  <div className="mb-2">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Rata-rata kategori: {fx(formatRupiah(anom.expected, true))}</span>
                      <span>Aktual: {fx(formatRupiah(anom.amount, true))}</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden relative">
                      <div className="h-full bg-success rounded-full" style={{ width: `${expectedPct}%` }} />
                      <div
                        className={`absolute top-0 h-full rounded-full ${anom.variance > 0 ? 'bg-danger/60' : 'bg-info/60'}`}
                        style={{ left: `${expectedPct}%`, width: `${Math.max(0, 100 - expectedPct)}%` }}
                      />
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground italic">
                    Dibandingkan {anom.peerCount} transaksi lain di kategori {anom.category} — {Math.abs(anom.variancePct).toFixed(1)}%{' '}
                    {anom.variance > 0 ? 'di atas' : 'di bawah'} rata-rata kategori.
                  </p>

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => router.push('/transactions')}
                      className="text-xs text-primary hover:underline font-medium"
                    >
                      View Transactions
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      onClick={() => router.push('/accounts-payable')}
                      className="text-xs text-primary hover:underline font-medium"
                    >
                      View Vendor
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      onClick={() => toast.success('Investigation initiated')}
                      className="text-xs text-primary hover:underline font-medium"
                    >
                      Investigate
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="LightBulbIcon" size={16} className="text-warning" />
          <h3 className="text-md font-semibold text-foreground">AI Recommendations</h3>
        </div>
        <div className="space-y-3">
          {(anomalies.length === 0
            ? [{
                priority: 'Low' as RiskLevel,
                title: 'Tidak ada tindakan mendesak',
                desc: 'Seluruh pengeluaran masih berada dalam rentang normal dibanding riwayat masing-masing kategori. Lanjutkan pemantauan rutin.',
                action: 'View Transactions',
                route: '/transactions',
              }]
            : anomalies.slice(0, 3).map((a) => ({
                priority: a.risk,
                title: `Tinjau ${a.account} (${a.vendor})`,
                desc: `Pengeluaran ${fx(formatRupiah(a.amount, true))} ${a.variance > 0 ? 'melebihi' : 'di bawah'} rata-rata kategori ${a.category} (${fx(formatRupiah(a.expected, true))}) sebesar ${Math.abs(a.variancePct).toFixed(1)}%. ${a.risk === 'High' ? 'Perlu eskalasi & verifikasi segera.' : 'Perlu klarifikasi dari pemilik anggaran/approval.'}`,
                action: 'View Transactions',
                route: '/transactions',
              }))
          ).map((rec, i) => (
            <div key={`ea-rec-${i}`} className="flex items-start gap-3 p-3 border border-border rounded-lg">
              <span className={`text-2xs px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 mt-0.5 ${
                rec.priority === 'High' ? 'bg-danger-bg text-danger-foreground' :
                rec.priority === 'Medium' ? 'bg-warning-bg text-warning-foreground' : 'bg-secondary text-muted-foreground'
              }`}>{rec.priority}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{rec.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{rec.desc}</p>
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