'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import KpiCard from '@/components/shared/KpiCard';
import TransactionDrawer from '../../components/TransactionDrawer';
import TransactionsGroupPanel from '../../components/TransactionsGroupPanel';
import { Transaction, tambahHariISO } from '../../components/transactionData';
import { useTransactions } from '../../context/TransactionsContext';
import { formatIDR, txAmount, uniqueJournalTotal, uniqueJournalCount, countJournalsByStatus, draftJournalTotal, monthlyTrendFor, categoryBreakdown, topParties, CHART_COLORS, formatDate, transactionsMissingJeId, unbalancedJournals, paidJournalTotal, overdueJournals } from '../../lib/groupAnalytics';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import StatusBadge from '@/components/ui/StatusBadge';
import { useLanguage } from '@/lib/language';

// ── Lebar overlay drag-zoom sumbu Y (sama pola dengan chart Financial
// Overview / Balance Sheet): width YAxis (65) + margin.left AreaChart (10). ──
const SALES_AXIS_WIDTH = 65;
const SALES_AXIS_OVERLAY_WIDTH = SALES_AXIS_WIDTH + 10;
const SALES_SPRING_MS = 380;
const salesEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

interface SalesDragPreview {
  index: number;
  value: number;
}

function SalesTrendTooltip({
  active,
  payload,
  label,
  dragPreview,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string; payload: { month: string } }[];
  label?: string;
  dragPreview?: SalesDragPreview | null;
}) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  const isDragged = !!dragPreview;
  const value = isDragged ? dragPreview!.value : entry.value;
  return (
    <div style={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }} className="bg-white p-3">
      <p className="font-semibold text-slate-800 mb-1">{label}</p>
      <p className="text-teal-600">
        {entry.name}: {isDragged ? 'Estimasi · ' : ''}
        {formatIDR(value)}
      </p>
    </div>
  );
}

const statusVariant: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'negative'> = {
  Unposted: 'neutral', Posted: 'info', Draft: 'warning', Reconciled: 'positive', Voided: 'negative',
};

// [BARU] Tab "Overview" halaman Sales. Murni turunan dari data di halaman
// Transaksi utama: seluruh baris yang tergolong kelompok 'sales' (lihat
// getTransactionGroup() di components/transactionData.ts — akun Pendapatan/
// Piutang, atau category 'Revenue') diambil lewat getByGroup('sales') dari
// TransactionsContext, lalu dianalisa & ditabelkan di sini. Tidak ada data
// dummy — semuanya dari state transaksi asli aplikasi.
//
// [DIPINDAH] Konten ini sebelumnya adalah seluruh isi sales/page.tsx.
// Sekarang page.tsx cuma memanggil <SalesClient /> yang punya 6 tab
// (Overview, Source Data, Sales Transaction, Journal Preview, Exceptions,
// Posted) — komponen ini jadi isi tab "Overview"-nya.
export default function SalesOverview() {
  const { t } = useLanguage();
  const { getByGroup, isSampleData } = useTransactions();
  // [FIX] TransactionsContext jatuh ke ALL_TRANSACTIONS (data contoh statis
  // di transactionData.ts) begitu fetch jurnal client aktif ke backend LAMA
  // gagal/kosong -- termasuk SELALU gagal untuk client manapun sekarang,
  // karena activeClientId sudah UUID (management_clients) sedangkan endpoint
  // lama (GET /api/client/{id}/jurnal-posting) masih mengharapkan integer
  // (lihat catatan di clientsStore.tsx & TransactionsContext.tsx::
  // loadFromBackend). Tab Overview ini TIDAK boleh menampilkan data contoh
  // itu seolah-olah data Sales sungguhan -- treat sebagai kosong saja kalau
  // isSampleData true, supaya tidak membingungkan (angka KPI ada padahal
  // tabel Sales Transaction/Posted yang sudah terhubung ke backend baru
  // masih benar-benar kosong).
  const salesTx = useMemo(() => (isSampleData ? [] : getByGroup('sales')), [getByGroup, isSampleData]);

  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // ── KPI (dihitung langsung dari salesTx, bukan angka statis) ──
  const grossSales = uniqueJournalTotal(salesTx);
  const txCount = uniqueJournalCount(salesTx);
  const avgTxValue = txCount > 0 ? grossSales / txCount : 0;
  const unpostedCount = countJournalsByStatus(salesTx, 'Unposted');
  const reconciledCount = countJournalsByStatus(salesTx, 'Reconciled');
  const reconciledPct = txCount > 0 ? (reconciledCount / txCount) * 100 : 0;
  const draftCount = countJournalsByStatus(salesTx, 'Draft');
  const draftTotal = draftJournalTotal(salesTx);

  // [BARU] KPI turunan dari kolom pajak & piutang di tabel Sales di bawah
  // (DPP, PPN, PPh, Paid, Outstanding, Due Date) — rumusnya SAMA PERSIS
  // dengan render() masing-masing kolom (lihat definisi `columns` di bawah),
  // cuma dijumlahkan di level agregat (grossSales) alih-alih per baris,
  // hasilnya identik karena rumusnya linear terhadap Gross.
  const totalDPP = grossSales / 1.11;
  const totalPPN = grossSales - totalDPP;
  const totalPPh = totalDPP * 0.01;
  const totalPaid = paidJournalTotal(salesTx);
  const totalOutstanding = grossSales - totalPaid;
  const overdue = useMemo(() => overdueJournals(salesTx), [salesTx]);

  // [BARU] Peringatan integritas data: baris Sales yang tidak punya jeId.
  const missingJeIdCount = useMemo(() => transactionsMissingJeId(salesTx).length, [salesTx]);

  // [BARU] Peringatan integritas data — jurnal (jeId) yang total debit &
  // kreditnya tidak sama.
  const unbalanced = useMemo(() => unbalancedJournals(salesTx), [salesTx]);

  const trend = useMemo(() => monthlyTrendFor(salesTx), [salesTx]);
  // [DIUBAH] Sales per Kategori sekarang HANYA berisi akun Pendapatan (kode
  // 4xxx) — mis. Consulting Revenue, Software Development Revenue,
  // Maintenance Revenue. Sebelumnya jurnal Sales yang tidak punya kaki akun
  // 4xxx (mis. hasil import yang belum berpasangan) jatuh ke fallback "kaki
  // bernilai terbesar", yang bisa jadi akun NERACA seperti "Kas & Bank —
  // BCA/Mandiri" atau "Piutang Usaha" — itu bukan jenis pendapatan, cuma
  // sisi pasangan jurnal, jadi salah kalau muncul sebagai "kategori sales".
  // Sekarang jurnal seperti itu dikelompokkan eksplisit ke satu bucket
  // "Pendapatan Lain-lain (Belum Teridentifikasi)" supaya tetap kelihatan &
  // bisa ditinjau, tanpa mencemari daftar kategori dengan akun neraca.
  const byCategory = useMemo(
    () =>
      categoryBreakdown(salesTx, {
        requireAccountCodePrefix: '4',
        fallbackLabel: 'Pendapatan Lain-lain (Belum Teridentifikasi)',
      }).slice(0, 6),
    [salesTx]
  );
  const topCustomers = useMemo(() => topParties(salesTx, 5), [salesTx]);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama seperti chart
  // Financial Overview / Balance Sheet. ──
  const salesBaseMax = useMemo(() => Math.max(1, ...trend.map((d) => d.total)) * 1.08, [trend]);
  const [salesPriceZoom, setSalesPriceZoom] = useState(1);
  const salesZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: salesYTicks } = useMemo(
    () => getNiceTicksFromZero(salesBaseMax / salesPriceZoom, 5),
    [salesBaseMax, salesPriceZoom]
  );
  const salesYDomain = useMemo<[number, number]>(() => [0, salesBaseMax / salesPriceZoom], [salesBaseMax, salesPriceZoom]);
  const salesYDomainRef = useRef(salesYDomain);
  salesYDomainRef.current = salesYDomain;

  const handleSalesAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    salesZoomDragRef.current = { startY: e.clientY, startZoom: salesPriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!salesZoomDragRef.current) return;
      const deltaY = salesZoomDragRef.current.startY - ev.clientY; // tarik ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, salesZoomDragRef.current.startZoom * factor));
      setSalesPriceZoom(next);
    };
    const onUp = () => {
      salesZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetSalesZoom = () => setSalesPriceZoom(1);

  // ── Drag titik data (tarik nilai "total" bulan tertentu) — kalibrasi
  // piksel<->nilai dari titik lain, live preview, spring-back saat dilepas. ──
  const salesDotsRef = useRef<{ value: number; cy: number }[]>([]);
  const [salesDragPreview, setSalesDragPreview] = useState<SalesDragPreview | null>(null);
  const salesDragStateRef = useRef<{
    index: number;
    originalValue: number;
    currentValue: number;
    startClientY: number;
    pxPerUnit: number;
  } | null>(null);
  const salesAnimRef = useRef<number | null>(null);

  const stopSalesSpring = () => {
    if (salesAnimRef.current) cancelAnimationFrame(salesAnimRef.current);
    salesAnimRef.current = null;
  };

  useEffect(() => {
    stopSalesSpring();
    salesDragStateRef.current = null;
    setSalesDragPreview(null);
    salesDotsRef.current = [];
  }, [trend]);

  useEffect(() => stopSalesSpring, []);

  const springBackSales = useCallback(() => {
    const drag = salesDragStateRef.current;
    if (!drag) return;
    stopSalesSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / SALES_SPRING_MS);
      const eased = salesEaseOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (salesDragStateRef.current) salesDragStateRef.current.currentValue = next;
      setSalesDragPreview({ index, value: next });
      if (elapsed < 1) {
        salesAnimRef.current = requestAnimationFrame(step);
      } else {
        salesDragStateRef.current = null;
        salesAnimRef.current = null;
        setSalesDragPreview(null);
      }
    };
    salesAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handleSalesDotPointerDown = useCallback((e: React.PointerEvent, index: number, originalValue: number) => {
    e.preventDefault();
    e.stopPropagation();
    stopSalesSpring();

    const samples = salesDotsRef.current.filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      const [dMin, dMax] = salesYDomainRef.current;
      pxPerUnit = -160 / (dMax - dMin || 1);
    }

    salesDragStateRef.current = {
      index,
      originalValue,
      currentValue: originalValue,
      startClientY: e.clientY,
      pxPerUnit,
    };
    setSalesDragPreview({ index, value: originalValue });
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = salesDragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = salesYDomainRef.current;
      const maxValue = dMax * 1.4;
      const value = Math.max(0, Math.min(maxValue, drag.originalValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setSalesDragPreview({ index: drag.index, value });
    };
    const handleUp = () => {
      if (salesDragStateRef.current) springBackSales();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBackSales]);

  const salesDisplayTrend = useMemo(() => {
    if (!salesDragPreview) return trend;
    return trend.map((d, i) => (i === salesDragPreview.index ? { ...d, total: salesDragPreview.value } : d));
  }, [trend, salesDragPreview]);

  // Dot tak terlihat: cuma merekam posisi piksel & nilai asli tiap titik, buat kalibrasi drag.
  const renderSalesCalibrationDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    salesDotsRef.current[index] = { value: payload.total, cy };
    return <circle key={`sales-cal-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot terlihat + target genggam (hit-area) lebih besar di atasnya, biar mudah ditarik.
  const renderSalesActiveDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = salesDragPreview?.index === index;
    return (
      <g key={`sales-pt-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill="#14b8a6" stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handleSalesDotPointerDown(e, index, payload.total)}
        />
      </g>
    );
  };

  // [DIUBAH] Susunan & judul kolom disamakan dengan acuan baru: Date, Invoice,
  // Customer, Description, DPP, PPN, PPh, Gross, Paid, Outstanding, Due Date,
  // Journal, Status. Kolom yang datanya sudah ada di model Transaction (date,
  // txId, party, description, status) tetap memakai data asli — cuma judulnya
  // yang disesuaikan (mis. "TX ID" -> "Invoice"). Kolom yang belum ada
  // sumber datanya di model Transaction saat ini (DPP, PPN, PPh, Gross, Paid,
  // Outstanding, Due Date, Journal) SENGAJA dikosongkan dulu ('—') sesuai
  // permintaan — isi datanya menyusul, fokus dulu ke struktur kolom.
  // [DIUBAH] Kolom yang tadinya kosong (DPP, PPN, PPh, Gross, Paid,
  // Outstanding, Due Date, Journal) sekarang diisi data TURUNAN dari
  // transaksi asli (bukan angka acak) — supaya format & perhitungannya
  // sudah benar duluan, tinggal gampang disambungkan ke sumber data pajak
  // yang sebenarnya nanti kalau sudah ada:
  //  - Gross  = txAmount(r) → nilai baris (debit+kredit)
  //  - DPP    = Gross ÷ 1,11 (asumsi tarif PPN 11%)
  //  - PPN    = Gross − DPP
  //  - PPh    = 1% dari DPP (placeholder, belum ada aturan tarif riil)
  //  - Paid   = Gross kalau status Posted/Reconciled (dianggap lunas),
  //             0 kalau masih Unposted/Draft/Voided
  //  - Outstanding = Gross − Paid
  //  - Due Date = tanggal transaksi + 14 hari (termin standar)
  //  - Journal  = jeId, fallback ke reference kalau jeId kosong
  const columns = [
    { key: 'date', label: t('Date'), sortable: true, headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap', render: (r: Transaction) => <span className="font-mono text-xs">{formatDate(r.date)}</span> },
    { key: 'txId', label: t('Invoice'), headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap', render: (r: Transaction) => <span className="font-mono text-xs text-teal-600">{r.txId}</span> },
    { key: 'party', label: t('Customer'), headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap', render: (r: Transaction) => <span className="font-medium text-xs">{r.party}</span> },
    // [DIUBAH] Description sebelumnya truncate/wrap (max-w-xs truncate block)
    // — sekarang whitespace-nowrap juga, sesuai permintaan: biar tabel
    // melebar ke kanan & discroll, bukan ada isi sel yang menurun.
    { key: 'description', label: t('Description'), headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap', render: (r: Transaction) => <span className="text-xs text-muted-foreground">{r.description}</span> },
    {
      key: 'dpp', label: t('DPP'), sortable: true, headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap',
      render: (r: Transaction) => <span className="font-mono text-xs">{formatIDR(txAmount(r) / 1.11, true)}</span>,
    },
    {
      key: 'ppn', label: t('PPN'), sortable: true, headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap',
      render: (r: Transaction) => {
        const gross = txAmount(r);
        const dpp = gross / 1.11;
        return <span className="font-mono text-xs">{formatIDR(gross - dpp, true)}</span>;
      },
    },
    {
      key: 'pph', label: t('PPh'), sortable: true, headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap',
      render: (r: Transaction) => {
        const dpp = txAmount(r) / 1.11;
        return <span className="font-mono text-xs">{formatIDR(dpp * 0.01, true)}</span>;
      },
    },
    {
      key: 'gross', label: t('Gross'), sortable: true, headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap',
      render: (r: Transaction) => <span className="font-mono text-xs font-semibold">{formatIDR(txAmount(r), true)}</span>,
    },
    {
      key: 'paid', label: t('Paid'), sortable: true, headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap',
      render: (r: Transaction) => {
        const lunas = r.status === 'Posted' || r.status === 'Reconciled';
        return <span className="font-mono text-xs">{lunas ? formatIDR(txAmount(r), true) : formatIDR(0, true)}</span>;
      },
    },
    {
      key: 'outstanding', label: t('Outstanding'), sortable: true, headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap',
      render: (r: Transaction) => {
        const gross = txAmount(r);
        const lunas = r.status === 'Posted' || r.status === 'Reconciled';
        const outstanding = lunas ? 0 : gross;
        return <span className={`font-mono text-xs ${outstanding > 0 ? 'text-amber-600 font-semibold' : ''}`}>{formatIDR(outstanding, true)}</span>;
      },
    },
    {
      key: 'dueDate', label: t('Due Date'), sortable: true, headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap',
      render: (r: Transaction) => <span className="font-mono text-xs">{formatDate(tambahHariISO(r.date, 14))}</span>,
    },
    {
      key: 'journal', label: t('Journal'), headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap',
      render: (r: Transaction) => <span className="font-mono text-xs text-muted-foreground">{r.jeId || r.reference || '—'}</span>,
    },
    { key: 'status', label: t('Status'), headerClassName: 'text-center whitespace-nowrap', className: 'whitespace-nowrap', render: (r: Transaction) => <StatusBadge variant={statusVariant[r.status] || 'neutral'} label={t(r.status)} dot /> },
  ];

  return (
    <div className="space-y-5">
      {/* [DIHAPUS] Judul "Sales" + subjudul dihapus dari sini — sudah
          ditampilkan oleh SalesClient (header halaman + tab). */}

      {/* Peringatan integritas data — cuma tampil kalau ada baris Sales
          tanpa jeId, yang berarti akurasi KPI di bawah (terutama Total
          Sales) bergantung pada fallback pencocokan `reference`. */}
      {missingJeIdCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">{t('Perhatian:')}</span>
          <span>
            {missingJeIdCount} {t('baris transaksi Sales tidak memiliki nomor jurnal (jeId). KPI di bawah tetap dihitung memakai nomor referensi sebagai gantinya, tapi sebaiknya ditinjau di halaman Transaksi utama.')}
          </span>
        </div>
      )}

      {/* Peringatan integritas data — jurnal dengan 2+ baris yang total
          debit & kreditnya tidak sama. */}
      {unbalanced.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">{t('Perhatian:')}</span>
          <span>
            {unbalanced.length} {t('jurnal Sales tidak balance (total debit ≠ total kredit) — contoh:')} {unbalanced[0].jeId}
            {' '}({t('selisih')} {formatIDR(unbalanced[0].diff, true)}). {t('Total Sales tetap dihitung dari sisi yang lebih besar, tapi sebaiknya jurnal ini diperbaiki di halaman Transaksi utama.')}
          </span>
        </div>
      )}

      {/* Peringatan: transaksi Draft (pending approval) sengaja dikeluarkan
          dari Total Sales. */}
      {draftCount > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">{t('Perhatian:')}</span>
          <span>
            {draftCount} {t('transaksi Sales senilai')} {formatIDR(draftTotal, true)} {t('masih berstatus Draft (menunggu approval) — belum termasuk dalam Total Sales di bawah sampai disetujui.')}
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard
          title={t('Total Sales')}
          value={grossSales}
          icon="ShoppingCartIcon"
          iconColor="text-teal-600"
          iconBg="bg-teal-50"
          subLabel={draftCount > 0 ? `+ ${formatIDR(draftTotal, true)} ${t('pending approval')}` : undefined}
        />
        <KpiCard title={t('Number of Transactions')} value={String(txCount)} icon="DocumentTextIcon" iconColor="text-blue-600" iconBg="bg-blue-50" />
        <KpiCard title={t('Average per Transaction')} value={avgTxValue} icon="CalculatorIcon" iconColor="text-orange-600" iconBg="bg-orange-50" />
        <KpiCard title={t('Unposted')} value={String(unpostedCount)} icon="ClockIcon" iconColor="text-amber-600" iconBg="bg-amber-50" alert={unpostedCount > 0} />
        <KpiCard title={t('Reconciliation')} value={`${reconciledPct.toFixed(0)}%`} icon="CheckCircleIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
      </div>

      {/* [BARU] KPI baris ke-2 — melengkapi kolom tabel Sales (DPP, PPN, PPh,
          Paid, Outstanding, Due Date) yang sebelumnya belum punya KPI card
          sendiri. Semua nilai turunan langsung dari salesTx, rumus sama
          persis dengan kolom terkait di tabel di bawah.
          [DIUBAH] 3 judul disamakan dengan istilah akuntansi standar sesuai
          permintaan: "Total Outstanding" → "Accounts Receivable" (pakai key
          terjemahan yang sudah ada, dipakai juga di Financial Overview),
          "Total PPN" → "VAT Output", "Total Dibayar" → "Paid". Semua judul
          & sublabel di baris ini sekarang ikut berubah sesuai fitur bahasa
          di header (lihat useLanguage()/t() di atas), bukan lagi teks
          statis Bahasa Indonesia. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard title={t('Total Tax Base (DPP)')} value={totalDPP} icon="ScaleIcon" iconColor="text-slate-600" iconBg="bg-slate-100" />
        <KpiCard title={t('VAT Output')} value={totalPPN} icon="ReceiptPercentIcon" iconColor="text-purple-600" iconBg="bg-purple-50" />
        <KpiCard title={t('Total Withholding Tax (PPh)')} value={totalPPh} icon="BuildingLibraryIcon" iconColor="text-indigo-600" iconBg="bg-indigo-50" />
        <KpiCard title={t('Paid')} value={totalPaid} icon="CreditCardIcon" iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <KpiCard
          title={t('Accounts Receivable')}
          value={totalOutstanding}
          icon="BanknotesIcon"
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
          alert={totalOutstanding > 0}
        />
        <KpiCard
          title={t('Overdue Invoices')}
          value={String(overdue.count)}
          subLabel={overdue.count > 0 ? `${t('Worth')} ${formatIDR(overdue.total, true)}` : undefined}
          icon="ExclamationTriangleIcon"
          iconColor="text-red-600"
          iconBg="bg-red-50"
          alert={overdue.count > 0}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-foreground">{t('Tren Sales Bulanan')}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t('Berdasarkan transaksi yang tercatat di halaman Transaksi')}</p>
          </div>
          {trend.every(pt => pt.total === 0) ? (
            <p className="text-xs text-muted-foreground py-10 text-center">{t('Belum ada transaksi Sales untuk ditampilkan.')}</p>
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={salesDisplayTrend} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradSalesMain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={v => formatIDR(v, true)}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={SALES_AXIS_WIDTH}
                    ticks={salesYTicks}
                    domain={salesYDomain}
                    allowDataOverflow
                  />
                  <Tooltip content={<SalesTrendTooltip dragPreview={salesDragPreview} />} cursor={false} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Sales"
                    stroke="#14b8a6"
                    strokeWidth={2.5}
                    fill="url(#gradSalesMain)"
                    dot={renderSalesCalibrationDot as any}
                    activeDot={renderSalesActiveDot as any}
                    isAnimationActive={!salesDragPreview}
                  />
                </AreaChart>
              </ResponsiveContainer>
              {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
              <div
                onMouseDown={handleSalesAxisMouseDown}
                onDoubleClick={resetSalesZoom}
                title={t('Tarik untuk zoom skala harga · klik dua kali untuk reset')}
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: SALES_AXIS_OVERLAY_WIDTH }}
              />
            </div>
          )}
        </div>

        <div className="card-elevated-md rounded-xl p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">{t('Sales per Kategori')}</h2>
          <p className="text-xs text-muted-foreground mb-3">{t('Breakdown pendapatan')}</p>
          {byCategory.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">{t('Belum ada data.')}</p>
          ) : (
            <div className="space-y-2.5">
              {byCategory.map((cat, i) => {
                const total = byCategory.reduce((s, c) => s + c.value, 0);
                const pct = total > 0 ? (cat.value / total) * 100 : 0;
                return (
                  <div key={cat.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground truncate flex-1">{t(cat.name)}</span>
                      <span className="text-xs font-semibold font-mono ml-2">{formatIDR(cat.value, true)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Top Customers */}
      <div className="card-elevated-md rounded-xl p-5 mb-6">
        <h2 className="text-sm font-bold text-foreground mb-1">{t('Top Customer')}</h2>
        <p className="text-xs text-muted-foreground mb-4">{t('Berdasarkan kontribusi nominal')}</p>
        {topCustomers.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">{t('Belum ada data.')}</p>
        ) : (
          <div className="space-y-3">
            {topCustomers.map((c, i) => {
              const max = topCustomers[0].amount || 1;
              return (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-text-muted w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-foreground truncate">{c.name}</span>
                      <span className="text-xs font-semibold font-mono text-teal-600 ml-2">{formatIDR(c.amount, true)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full bg-teal-400" style={{ width: `${(c.amount / max) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Aksi & Upload Data + Tabel Transaksi Sales — digabung jadi 1 kolom,
          aksi & filter di atas tabel. searchPlaceholder disesuaikan dengan
          istilah kolom Sales yang baru (Invoice/Customer), khusus halaman
          ini saja — halaman Expense/Purchase/dst tetap pakai teks default.
          [FIX] TransactionsGroupPanel baca group='sales' LANGSUNG dari
          TransactionsContext (bukan dari salesTx di atas) -- kalau tidak
          ikut disembunyikan saat isSampleData, tabel ini tetap menampilkan
          baris ALL_TRANSACTIONS (data contoh) walau KPI di atas sudah benar
          kosong, jadi tetap membingungkan. Komponennya sendiri TIDAK diubah
          (dipakai bareng oleh Expense/Purchase/Cash Payment/Cash Receipt/
          Other) -- cukup tidak dirender di sini saat data contoh. */}
      {isSampleData ? (
        <div className="card-elevated-md rounded-xl p-8 text-center text-xs text-muted-foreground">
          {t('Belum ada transaksi Sales untuk client ini.')}
        </div>
      ) : (
        <TransactionsGroupPanel
          group="sales"
          groupLabel={t('Sales')}
          defaultCategory="Revenue"
          columns={columns}
          onRowClick={setSelectedTx}
          searchPlaceholder={t('Cari Invoice, deskripsi, customer, no. jurnal...')}
        />
      )}

      {selectedTx && <TransactionDrawer transaction={selectedTx} onClose={() => setSelectedTx(null)} />}
    </div>
  );
}