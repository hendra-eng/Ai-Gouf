'use client';
import React from 'react';
import Icon from '@/components/ui/AppIcon';
import FinancialInsightCard from '@/components/ui/FinancialInsightCard';
import { useCurrency } from '@/lib/currency';
import { formatRupiah } from '@/lib/mockData';
import { useApErrorDetection, type PurchaseCheckResult } from '../lib/apErrorDetection';

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '\u2014';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toLocaleString('id-ID') : formatRupiah(v, true);
  }
  return String(v);
}

function CheckCard({ check }: { check: PurchaseCheckResult }) {
  const ringkasanEntries = Object.entries(check.ringkasan || {}).filter(
    ([k, v]) => k !== 'catatan' && typeof v !== 'object'
  );
  const flagged = check.findings.filter((f) => !f.ok);
  const isRekap = check.code === 'rekap_supplier';

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-foreground">{check.label}</span>
        {!isRekap && (
          <span className={`fin-badge text-[10px] px-1.5 py-0 ${check.reviewCount > 0 ? 'bg-warning-subtle text-warning border border-amber-100' : 'bg-positive-subtle text-positive border border-green-100'}`}>
            {check.reviewCount > 0 ? `${check.reviewCount} need review` : 'Clean'}
          </span>
        )}
      </div>

      {ringkasanEntries.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-3 pb-3 border-b border-border">
          {ringkasanEntries.map(([k, v]) => (
            <div key={k} className="text-[11px]">
              <span className="text-muted-foreground capitalize">{k.replaceAll('_', ' ')}: </span>
              <span className="font-medium text-foreground">{formatValue(v)}</span>
            </div>
          ))}
        </div>
      )}

      {isRekap ? (
        check.findings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-medium">Supplier</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {check.findings.map((f, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-3 text-foreground">{f.title}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{f.status || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">No supplier recap available.</p>
        )
      ) : flagged.length > 0 ? (
        <div className="space-y-2">
          {flagged.slice(0, 6).map((f, i) => (
            <div key={i} className="rounded-md border border-amber-100 bg-warning-subtle px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-foreground">{f.title}</span>
                {f.status && <span className="text-[10px] text-warning">{f.status.replaceAll('_', ' ')}</span>}
              </div>
              {f.reasons.length > 0 && (
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                  {f.reasons.map((r, ri) => (
                    <li key={ri} className="text-[10px] text-muted-foreground">{r}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {flagged.length > 6 && (
            <p className="text-[10px] text-muted-foreground">+{flagged.length - 6} more finding(s)</p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">No findings to report. \u2705</p>
      )}
    </div>
  );
}

/**
 * APErrorDetection -- panel "AI Error Detection" untuk halaman Accounts
 * Payable, menjalankan 7 pengecekan rule-based Agent AI
 * (deteksiKesalahanPembelian) atas dokumen pembelian client aktif dan
 * menyandingkannya dengan AP aging yang sudah dihitung dari transaksi
 * Expense (apBridge.ts).
 */
export default function APErrorDetection() {
  const { fx } = useCurrency();
  const { loading, error, isEmpty, results, insights, refetch } = useApErrorDetection(formatRupiah);

  return (
    <div className="space-y-4">
      <div className="fin-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Icon name="SparklesIcon" size={16} className="text-ai" />
          <span className="text-[14px] font-600 text-foreground">Agent AI \u2014 Purchase Error Detection</span>
          <span className="fin-badge bg-ai-subtle text-ai border border-purple-200 text-[10px]">AI</span>
          <button
            onClick={refetch}
            disabled={loading}
            className="ml-auto flex items-center gap-1.5 text-xs border border-border rounded-md px-2.5 py-1 text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <Icon name="ArrowPathIcon" size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Running...' : 'Re-run checks'}
          </button>
        </div>
        <p className="text-[12px] text-muted-foreground mb-4">
          7 rule-based checks run against purchase documents processed by Agent AI (PO/Invoice matching, PPh 23,
          unusual pricing, new suppliers, date validation, supplier recap, and AP aging cross-check).
        </p>

        {error && (
          <div className="rounded-md border border-red-100 bg-negative-subtle text-negative text-[12px] px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {!error && isEmpty && !loading && (
          <div className="text-[12px] text-muted-foreground py-6 text-center">
            {`Select a client with processed purchase documents to run Agent AI's error detection.`}
          </div>
        )}

        {insights.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {insights.map((insight, i) => (
              <FinancialInsightCard
                key={`ap-err-insight-${i}`}
                title={insight.title}
                description={fx(insight.description)}
                metric={fx(insight.metric)}
                severity={insight.severity}
              />
            ))}
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {results.map((check) => (
            <CheckCard key={check.code} check={check} />
          ))}
        </div>
      )}
    </div>
  );
}
