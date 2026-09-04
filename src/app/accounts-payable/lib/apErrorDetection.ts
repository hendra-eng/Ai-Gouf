'use client';
// [BARU] ─── JEMBATAN AGENT AI (Deteksi Kesalahan Pembelian) → ACCOUNTS PAYABLE ──
// Halaman AP sudah tersambung ke jurnal REAL lewat TransactionsContext +
// apBridge.ts (lihat komentar di APContent.tsx), tapi satu kapabilitas Agent
// AI yang KHUSUS untuk Pembelian/AP belum pernah dipakai di halaman mana pun
// di dashboard: POST /api/client/{id}/deteksi-kesalahan-pembelian (lihat
// modules/deteksi_kesalahan_pembelian.py di backend), dibungkus di frontend
// sebagai deteksiKesalahanPembelian() di agent-ai/lib/api.js. Sebelumnya
// endpoint ini HANYA dipanggil dari dalam obrolan Agent AI (ChecklistPembelian.jsx)
// -- hasilnya tidak pernah terlihat di halaman Accounts Payable itu sendiri.
//
// 7 pengecekan rule-based (BUKAN AI generatif -- lihat docstring di
// api.js/main.py, jadi aman dipanggil otomatis saat halaman dibuka /
// client berganti, tidak seperti "Saran Cerdas" yang memang sengaja
// dipicu tombol karena memanggil DeepSeek):
//   1. po_invoice           -- Pencocokan PO <-> Invoice
//   2. pph23_jasa           -- Deteksi PPh 23 atas jasa
//   3. harga_tidak_wajar    -- Deteksi harga tidak wajar (riwayat)
//   4. supplier_baru        -- Deteksi supplier baru
//   5. validasi_tanggal     -- Validasi tanggal
//   6. rekap_supplier       -- Rekap per Supplier
//   7. cross_check_ap_aging -- Cross-check ke AP Aging (dibandingkan dgn
//      bills/vendors yang SUDAH dihitung apBridge.ts dari transaksi Expense)
//
// Modul ini HANYA menerjemahkan hasil mentah endpoint itu jadi bentuk yang
// gampang dirender (insight cards + daftar temuan per pengecekan) -- logic
// pengecekan itu sendiri tetap 100% di backend, tidak diduplikasi di sini.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveClient } from '@/lib/activeClient';
import { deteksiKesalahanPembelian } from '@/app/agent-ai/lib/api';
import { listenClientDataChanged } from '@/lib/dataSync';

export type PurchaseCheckCode =
  | 'po_invoice'
  | 'pph23_jasa'
  | 'harga_tidak_wajar'
  | 'supplier_baru'
  | 'validasi_tanggal'
  | 'rekap_supplier'
  | 'cross_check_ap_aging';

export const CHECK_LABELS: Record<PurchaseCheckCode, string> = {
  po_invoice: 'PO \u2194 Invoice Matching',
  pph23_jasa: 'PPh 23 Service Detection',
  harga_tidak_wajar: 'Unusual Price Detection',
  supplier_baru: 'New Supplier Detection',
  validasi_tanggal: 'Date Validation',
  rekap_supplier: 'Supplier Recap',
  cross_check_ap_aging: 'AP Aging Cross-check',
};

const CHECK_ORDER: PurchaseCheckCode[] = [
  'po_invoice', 'pph23_jasa', 'harga_tidak_wajar', 'supplier_baru',
  'validasi_tanggal', 'rekap_supplier', 'cross_check_ap_aging',
];

// Status dari backend yang dianggap "aman" -- selebihnya dianggap "perlu direview".
const STATUS_AMAN = new Set(['MATCHED', 'OK', 'OK_ADA_BUKTI_POTONG']);

export interface PurchaseCheckFinding {
  title: string;
  reasons: string[];
  status: string | null;
  ok: boolean;
}

export interface PurchaseCheckResult {
  code: PurchaseCheckCode;
  label: string;
  ringkasan: Record<string, unknown>;
  findings: PurchaseCheckFinding[];
  reviewCount: number;
}

export interface APInsight {
  title: string;
  description: string;
  metric: string;
  severity: 'info' | 'positive' | 'warning' | 'critical';
}

function toFinding(baris: any): PurchaseCheckFinding {
  const status: string | null = baris?.status ?? null;
  const ok = status ? STATUS_AMAN.has(status) : true;
  const title = [baris?.nomor_invoice || baris?.nomor_po || baris?.nomor_dokumen, baris?.nama_supplier, baris?.nama_barang]
    .filter(Boolean)
    .join(' \u00b7 ') || `Baris ${baris?.baris ?? ''}`;
  const reasons: string[] = Array.isArray(baris?.alasan) ? baris.alasan : baris?.catatan ? [baris.catatan] : [];
  return { title, reasons, status, ok };
}

function toCheckResult(code: PurchaseCheckCode, raw: any): PurchaseCheckResult {
  const hasil: any[] = raw?.hasil || [];
  const findings = hasil.map(toFinding);
  return {
    code,
    label: CHECK_LABELS[code],
    ringkasan: raw?.ringkasan || {},
    findings,
    reviewCount: findings.filter((f) => !f.ok).length,
  };
}

/** Ubah 7 hasil pengecekan mentah jadi insight card ringkas untuk header AP. */
export function insightsFromCheckResults(results: PurchaseCheckResult[], rp: (v: number) => string): APInsight[] {
  const insights: APInsight[] = [];
  const byCode = new Map(results.map((r) => [r.code, r]));

  const poInvoice = byCode.get('po_invoice');
  if (poInvoice && poInvoice.reviewCount > 0) {
    insights.push({
      title: 'PO / Invoice Mismatch',
      description: `${poInvoice.reviewCount} invoice line(s) do not match their purchase order (quantity, price, or missing PO). Review before approving payment.`,
      metric: `${poInvoice.reviewCount} line(s) need review`,
      severity: poInvoice.reviewCount > 5 ? 'critical' : 'warning',
    });
  }

  const pph23 = byCode.get('pph23_jasa');
  if (pph23 && pph23.reviewCount > 0) {
    insights.push({
      title: 'PPh 23 Withholding Gap',
      description: `${pph23.reviewCount} service invoice(s) appear subject to PPh 23 without matching bukti potong on file.`,
      metric: `${pph23.reviewCount} invoice(s) flagged`,
      severity: 'warning',
    });
  }

  const hargaTidakWajar = byCode.get('harga_tidak_wajar');
  if (hargaTidakWajar && hargaTidakWajar.reviewCount > 0) {
    insights.push({
      title: 'Unusual Pricing Detected',
      description: `${hargaTidakWajar.reviewCount} purchased item(s) are priced significantly outside this vendor's historical range.`,
      metric: `${hargaTidakWajar.reviewCount} item(s) flagged`,
      severity: 'warning',
    });
  }

  const supplierBaru = byCode.get('supplier_baru');
  if (supplierBaru && supplierBaru.findings.length > 0) {
    insights.push({
      title: 'New Suppliers This Period',
      description: `${supplierBaru.findings.length} supplier(s) billed this client for the first time. Confirm vendor onboarding/KYC is complete.`,
      metric: `${supplierBaru.findings.length} new supplier(s)`,
      severity: 'info',
    });
  }

  const tanggal = byCode.get('validasi_tanggal');
  if (tanggal && tanggal.reviewCount > 0) {
    insights.push({
      title: 'Date Inconsistencies',
      description: `${tanggal.reviewCount} document(s) have invoice/PO/due dates that don't line up logically (e.g. invoice dated before PO).`,
      metric: `${tanggal.reviewCount} document(s) flagged`,
      severity: 'warning',
    });
  }

  const crossCheck = byCode.get('cross_check_ap_aging');
  if (crossCheck && crossCheck.reviewCount > 0) {
    insights.push({
      title: 'AP Aging Discrepancy',
      description: `${crossCheck.reviewCount} item(s) from purchase documents don't reconcile cleanly against the AP aging computed from posted Expense transactions.`,
      metric: `${crossCheck.reviewCount} discrepanc(y/ies)`,
      severity: 'critical',
    });
  } else if (crossCheck) {
    insights.push({
      title: 'AP Aging Reconciled',
      description: 'Purchase documents processed by Agent AI reconcile cleanly against the AP aging derived from posted Expense transactions.',
      metric: 'No discrepancies found',
      severity: 'positive',
    });
  }

  if (insights.length === 0 && results.length > 0) {
    insights.push({
      title: 'No Purchase Errors Detected',
      description: 'All 7 automated purchase checks (PO matching, PPh 23, pricing, supplier, dates, AP aging) came back clean for this client.',
      metric: `${results.length} check(s) passed`,
      severity: 'positive',
    });
  }

  return insights;
}

export interface UseApErrorDetectionResult {
  loading: boolean;
  error: string | null;
  /** true kalau belum ada client aktif / belum pernah dijalankan -- hasil kosong, bukan data contoh. */
  isEmpty: boolean;
  results: PurchaseCheckResult[];
  insights: APInsight[];
  /** Panggil ulang manual (tombol "Run detection" / refresh). */
  refetch: () => void;
}

/** Hook: jalankan (atau muat ulang) 7 pengecekan Deteksi Kesalahan Pembelian untuk client aktif. */
export function useApErrorDetection(rp: (v: number) => string): UseApErrorDetectionResult {
  const { activeClientId } = useActiveClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PurchaseCheckResult[]>([]);
  const requestIdRef = useRef(0);

  const run = useCallback(() => {
    if (!activeClientId) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    deteksiKesalahanPembelian(activeClientId, [])
      .then((raw: Record<string, any>) => {
        if (requestIdRef.current !== requestId) return;
        const parsed = CHECK_ORDER.filter((code) => code in (raw || {})).map((code) => toCheckResult(code, raw[code]));
        setResults(parsed);
      })
      .catch((err: Error) => {
        if (requestIdRef.current !== requestId) return;
        console.error('Gagal menjalankan deteksi kesalahan pembelian:', err);
        setError(err?.message || 'Gagal menjalankan deteksi kesalahan pembelian.');
        setResults([]);
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setLoading(false);
      });
  }, [activeClientId]);

  useEffect(() => {
    run();
  }, [run]);

  // Jalankan ulang otomatis begitu Agent AI selesai upload/posting dokumen
  // pembelian baru untuk client yang sama -- sama seperti TransactionsContext.
  useEffect(() => {
    return listenClientDataChanged((changedClientId) => {
      if (changedClientId === activeClientId) run();
    });
  }, [activeClientId, run]);

  const insights = results.length > 0 ? insightsFromCheckResults(results, rp) : [];

  return { loading, error, isEmpty: results.length === 0, results, insights, refetch: run };
}
