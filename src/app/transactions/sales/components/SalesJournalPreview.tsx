'use client';

import React, { useState } from 'react';
import { Search, ChevronLeft, ChevronRight, CheckCircle, ChevronRight as Arrow } from 'lucide-react';
import { useLanguage } from '@/lib/language';

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

const INVOICES = [
  { id: 'INV-2024-0185', customer: 'PT Maju Bersama', date: '14 Nov 2024', amount: 620000000, status: 'Diproses' },
  { id: 'INV-2024-0184', customer: 'PT Solusi Digital', date: '14 Nov 2024', amount: 480000000, status: 'Siap Posting' },
  { id: 'INV-2024-0183', customer: 'PT Nusantara Teknologi', date: '12 Nov 2024', amount: 350000000, status: 'Siap Posting' },
  { id: 'INV-2024-0182', customer: 'CV Kreatif Indonesia', date: '10 Nov 2024', amount: 287500000, status: 'Diproses' },
  { id: 'INV-2024-0181', customer: 'PT Global Solusi', date: '08 Nov 2024', amount: 225000000, status: 'Diposting' },
  { id: 'INV-2024-0180', customer: 'PT Sejahtera Abadi', date: '06 Nov 2024', amount: 150000000, status: 'Diposting' },
  { id: 'INV-2024-0179', customer: 'PT Inovasi Mandiri', date: '02 Nov 2024', amount: 175000000, status: 'Siap Posting' },
  { id: 'INV-2024-0178', customer: 'CV Mitra Usaha', date: '01 Nov 2024', amount: 98000000, status: 'Diproses' },
];

const STATUS_BADGE: Record<string, string> = {
  'Diproses': 'bg-blue-100 text-blue-700',
  'Siap Posting': 'bg-emerald-100 text-emerald-700',
  'Diposting': 'bg-gray-100 text-gray-600',
};

const STEPS = [
  { n: 1, label: 'Source Document', sub: 'Dokumen sumber' },
  { n: 2, label: 'AI Extraction', sub: 'Ekstraksi data' },
  { n: 3, label: 'Accounting Classification', sub: 'Klasifikasi akun' },
  { n: 4, label: 'Tax Treatment', sub: 'Perlakuan pajak' },
  { n: 5, label: 'Journal', sub: 'Jurnal akuntansi' },
  { n: 6, label: 'Approve/Post', sub: 'Persetujuan' },
];

const JOURNAL_LINES = [
  { no: 1, code: '1120-01', name: 'Piutang Usaha - IDR', debit: 620000000, credit: 0 },
  { no: 2, code: '4100-01', name: 'Pendapatan Jasa Konsultasi', debit: 0, credit: 500000000 },
  { no: 3, code: '2100-01', name: 'PPN Keluaran', debit: 0, credit: 50000000 },
];

export default function SalesJournalPreview() {
  const { t } = useLanguage();
  const [selectedInvoice, setSelectedInvoice] = useState(INVOICES[0]);
  const [activeStep] = useState(1);

  return (
    <div className="flex gap-4 h-full">
      {/* Left: Invoice List */}
      <div className="w-72 flex-shrink-0 card overflow-hidden self-start">
        <div className="p-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground mb-2">{t('Daftar Invoice Penjualan')}</h3>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input type="text" placeholder={t('Cari nomor invoice atau pelanggan...')} className="w-full text-xs border border-border rounded-lg pl-8 pr-3 py-1.5 bg-card text-foreground" />
          </div>
        </div>
        <div className="overflow-y-auto max-h-[600px] scrollbar-thin">
          {INVOICES.map(inv => (
            <div
              key={inv.id}
              onClick={() => setSelectedInvoice(inv)}
              className={`p-3 border-b border-border/50 cursor-pointer transition-colors ${selectedInvoice.id === inv.id ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted/30'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-bold text-blue-600">INV</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{inv.id}</p>
                    <p className="text-[11px] text-muted-foreground">{inv.customer}</p>
                    <p className="text-[11px] text-muted-foreground">{inv.date}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-semibold text-foreground">{formatIDR(inv.amount)}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_BADGE[inv.status]}`}>{t(inv.status)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('Menampilkan 1 – 8 dari 32 invoice')}</span>
          <div className="flex items-center gap-1">
            <button className="p-0.5 hover:bg-muted rounded"><ChevronLeft size={12} /></button>
            {[1,2,3,4].map(p => <button key={p} className={`w-5 h-5 rounded text-[11px] ${p === 1 ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{p}</button>)}
            <button className="p-0.5 hover:bg-muted rounded"><ChevronRight size={12} /></button>
          </div>
        </div>
      </div>

      {/* Right: Detail */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-foreground">{t('Detail Journal Preview')}</h3>
            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">{t('Diproses')}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t('Lihat bagaimana transaksi penjualan diubah menjadi jurnal akuntansi')}</p>

          {/* Steps */}
          <div className="flex items-center gap-0 mt-4 overflow-x-auto scrollbar-thin pb-1">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.n}>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${s.n === 1 ? 'bg-primary border-primary text-primary-foreground' : s.n <= activeStep ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-card border-border text-muted-foreground'}`}>
                    {s.n <= activeStep && s.n !== 1 ? <CheckCircle size={14} /> : s.n}
                  </div>
                  <div className="text-center">
                    <p className={`text-[10px] font-semibold whitespace-nowrap ${s.n === 1 ? 'text-primary' : 'text-muted-foreground'}`}>{t(s.label)}</p>
                    <p className="text-[9px] text-muted-foreground whitespace-nowrap">{t(s.sub)}</p>
                  </div>
                </div>
                {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border mx-1 mt-[-12px]" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* 1. Source Document */}
          <div className="card p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold flex items-center justify-center">1</span>
              {t('Source Document')}
            </h4>
            <div className="bg-muted/30 rounded-lg p-3 mb-3 flex items-center gap-3">
              <div className="w-10 h-12 bg-white border border-border rounded flex items-center justify-center text-[9px] text-muted-foreground">PDF</div>
              <div className="text-xs space-y-1">
                {[
                  ['Nama File', `${selectedInvoice.id}.pdf`],
                  ['No. Invoice', selectedInvoice.id],
                  ['Pelanggan', selectedInvoice.customer],
                  ['Tanggal Invoice', selectedInvoice.date],
                  ['Total Invoice', formatIDR(selectedInvoice.amount)],
                  ['Tanggal Upload', '14 Nov 2024, 09:17'],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-muted-foreground w-24 flex-shrink-0">{t(k)}</span>
                    <span className="font-medium text-foreground">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <button className="w-full py-1.5 border border-border rounded-lg text-xs text-muted-foreground hover:bg-muted transition-colors flex items-center justify-center gap-1.5">
              👁 {t('Lihat Dokumen')}
            </button>
          </div>

          {/* 2. AI Extraction */}
          <div className="card p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="w-5 h-5 bg-purple-100 text-purple-700 rounded text-[10px] font-bold flex items-center justify-center">2</span>
              {t('AI Extraction')}
            </h4>
            <div className="space-y-2 text-xs">
              {[
                ['No. Invoice', selectedInvoice.id],
                ['Pelanggan', selectedInvoice.customer],
                ['Tipe Transaksi', <span key="t" className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]">{t('Penjualan Jasa')}</span>],
                ['Status Pajak', <span key="s" className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px]">{t('Dikenakan PPN')}</span>],
                ['Total DPP', formatIDR(500000000)],
                ['PPN (11%)', formatIDR(50000000)],
                ['Total Invoice', formatIDR(selectedInvoice.amount)],
                ['Confidence Score', <div key="c" className="flex items-center gap-2"><span className="text-emerald-600 font-bold">98%</span><div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: '98%' }} /></div></div>],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">{t(k as string)}</span>
                  <span className="font-medium text-foreground text-right">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Accounting Classification */}
          <div className="card p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="w-5 h-5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold flex items-center justify-center">3</span>
              {t('Accounting Classification')}
            </h4>
            <div className="space-y-2">
              {[
                { label: 'Akun Piutang Usaha', code: '1120-01', name: 'Piutang Usaha - IDR' },
                { label: 'Akun Pendapatan', code: '4100-01', name: 'Pendapatan Jasa Konsultasi' },
                { label: 'Akun PPN Keluaran', code: '2100-01', name: 'PPN Keluaran' },
                { label: 'Akun PPh (Jika ada)', code: null, name: 'Tidak ada potongan PPh' },
              ].map(a => (
                <div key={a.label} className="flex items-center justify-between py-1.5 border-b border-border/50">
                  <div>
                    <p className="text-[11px] text-muted-foreground">{t(a.label)}</p>
                    <p className="text-xs font-medium text-foreground">{a.code ? `${a.code} - ${t(a.name)}` : t(a.name)}</p>
                  </div>
                  <Arrow size={12} className="text-muted-foreground flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* 4. Tax Treatment */}
          <div className="card p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="w-5 h-5 bg-amber-100 text-amber-700 rounded text-[10px] font-bold flex items-center justify-center">4</span>
              {t('Tax Treatment')}
            </h4>
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg mb-3 flex items-start gap-2">
              <CheckCircle size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-emerald-700">{t('Dikenakan PPN (Taxable)')}</p>
                <p className="text-[11px] text-emerald-600">{t('Transaksi ini dikenakan PPN sesuai ketentuan yang berlaku.')}</p>
              </div>
            </div>
            <div className="space-y-1.5 text-xs">
              {[
                ['Dasar Pengenaan Pajak (DPP)', formatIDR(500000000)],
                ['Tarif PPN', '11%'],
                ['PPN Keluaran', formatIDR(50000000)],
                ['Total Termasuk PPN', formatIDR(550000000)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-muted-foreground">{t(k)}</span>
                  <span className="font-medium text-foreground">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 5. Journal Entry */}
          <div className="card p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="w-5 h-5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold flex items-center justify-center">5</span>
              {t('Journal Entry')}
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 px-2 text-[11px] font-semibold text-muted-foreground">{t('No.')}</th>
                    <th className="text-left py-1.5 px-2 text-[11px] font-semibold text-muted-foreground">{t('Account Code')}</th>
                    <th className="text-left py-1.5 px-2 text-[11px] font-semibold text-muted-foreground">{t('Account Name')}</th>
                    <th className="text-right py-1.5 px-2 text-[11px] font-semibold text-muted-foreground">{t('Debit (IDR)')}</th>
                    <th className="text-right py-1.5 px-2 text-[11px] font-semibold text-muted-foreground">{t('Credit (IDR)')}</th>
                  </tr>
                </thead>
                <tbody>
                  {JOURNAL_LINES.map(l => (
                    <tr key={l.no} className="border-b border-border/50">
                      <td className="py-1.5 px-2 text-muted-foreground">{l.no}</td>
                      <td className="py-1.5 px-2 text-primary font-medium">{l.code}</td>
                      <td className="py-1.5 px-2 text-foreground">{t(l.name)}</td>
                      <td className="py-1.5 px-2 text-right">{l.debit > 0 ? l.debit.toLocaleString('id-ID') : '—'}</td>
                      <td className="py-1.5 px-2 text-right">{l.credit > 0 ? l.credit.toLocaleString('id-ID') : '—'}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted/30 font-semibold">
                    <td colSpan={3} className="py-1.5 px-2 text-xs">{t('Total')}</td>
                    <td className="py-1.5 px-2 text-right text-xs">{(620000000).toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-2 text-right text-xs">{(550000000).toLocaleString('id-ID')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Action Bar */}
        <div className="card p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-blue-600">
            <span className="w-4 h-4 bg-blue-100 rounded-full flex items-center justify-center text-[9px]">ℹ</span>
            <span>{t('Jurnal ini siap untuk diposting. Silakan periksa kembali hasil klasifikasi akun dan pastikan sudah sesuai sebelum diposting ke buku besar.')}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button className="px-3 py-1.5 border border-border rounded-lg text-xs text-foreground hover:bg-muted transition-colors flex items-center gap-1.5">
              ✏ {t('Edit Mapping')}
            </button>
            <button className="px-3 py-1.5 border border-emerald-500 text-emerald-600 rounded-lg text-xs font-medium hover:bg-emerald-50 transition-colors flex items-center gap-1.5">
              <CheckCircle size={12} /> {t('Approve')}
            </button>
            <button className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5">
              📋 {t('Post Journal')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}