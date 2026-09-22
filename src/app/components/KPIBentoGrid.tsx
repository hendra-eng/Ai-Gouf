'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import MetricCard from '@/components/ui/MetricCard';
import { KPICardSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatMoney, useCurrency } from '@/lib/currency';
import { useLanguage } from '@/lib/language';
import { useActiveClient } from '@/lib/activeClient';
import { ambilKpiBento, ambilFinancialBudget } from '@/app/agent-ai/lib/api';
import { useProfitLossData, fetchMonthlyPLForYear } from '@/app/financial-statements/lib/useProfitLossData';
import type { OverviewViewMode } from './OverviewCharts';

// Bento grid plan: 8 cards → grid-cols-4
// Row 1: Revenue (hero, spans 2 cols) + Net Profit + Gross Profit
// Row 2: Cash & Bank + AR + AP + EBITDA + Tax Payable
// Adjusted: Row 1: 2+1+1 = 4 cols, Row 2: 1+1+1+1 = 4 cols → ✓ no orphans

// [BARU] Data KPI sekarang REAL: diambil dari backend
// GET /api/client/{id}/kpi-bento (lihat backend/modules/laporan_keuangan.py
// ::susun_kpi_bento_dashboard) lewat ambilKpiBento(). Data mock di bawah
// (MOCK_SPARKLINES/MOCK_KARTU) HANYA dipakai sbg FALLBACK -- saat belum
// ada client aktif dipilih, atau saat fetch ke backend gagal -- supaya
// grid ini tidak pernah kosong total dan tetap bisa didemokan tanpa
// backend menyala (pola yang sama seperti TransactionsContext.tsx).

interface KartuKpiBackend {
  label: string;
  nilai: number;
  satuan: string;
  perubahan_persen: number;
  margin_persen: number | null;
  sparkline: number[];
}

interface KpiBentoResponse {
  tahun: number;
  bulan_sampai: number;
  kartu: KartuKpiBackend[];
  meta: { peringatan?: string[] };
}

const MOCK_SPARKLINES: Record<string, number[]> = {
  'Total Revenue': Array(8).fill(0),
  'Net Profit': Array(8).fill(0),
  'Gross Profit': Array(8).fill(0),
  'Cash & Bank': Array(8).fill(0),
  'Accounts Receivable': Array(8).fill(0),
  'Accounts Payable': Array(8).fill(0),
  'EBITDA': Array(8).fill(0),
  'Tax Payable': Array(8).fill(0),
};

const MOCK_CHANGE: Record<string, number> = {
  'Total Revenue': 0,
  'Net Profit': 0,
  'Gross Profit': 0,
  'Cash & Bank': 0,
  'Accounts Receivable': 0,
  'Accounts Payable': 0,
  'EBITDA': 0,
  'Tax Payable': 0,
};

function buatKartuMock(): KartuKpiBackend[] {
  return Object.keys(MOCK_SPARKLINES).map((label) => ({
    label,
    nilai: MOCK_SPARKLINES[label][MOCK_SPARKLINES[label].length - 1],
    satuan: 'rupiah',
    perubahan_persen: MOCK_CHANGE[label],
    margin_persen: null,
    sparkline: MOCK_SPARKLINES[label],
  }));
}

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

function buatKartuKosong(): KartuKpiBackend[] {
  return Object.keys(MOCK_SPARKLINES).map((label) => ({
    label,
    nilai: 0,
    satuan: 'rupiah',
    perubahan_persen: 0,
    margin_persen: null,
    sparkline: Array(8).fill(0),
  }));
}

// Konfigurasi tampilan per kartu (id, tujuan klik, arah status, hero).
// "arahBaik": 'naik' -> makin tinggi makin bagus (positif = hijau).
//             'turun' -> makin rendah makin bagus (positif = merah/warning).
const KONFIGURASI_KARTU: Record<
  string,
  { id: string; route: string; hero?: boolean; arahBaik: 'naik' | 'turun'; warningJikaAda?: boolean }
> = {
  'Total Revenue': { id: 'kpi-revenue', route: '/financial-statements/profit-loss', hero: true, arahBaik: 'naik' },
  'Net Profit': { id: 'kpi-netprofit', route: '/financial-statements/profit-loss', arahBaik: 'naik' },
  'Gross Profit': { id: 'kpi-grossprofit', route: '/financial-statements/profit-loss', arahBaik: 'naik' },
  'Cash & Bank': { id: 'kpi-cash', route: '/financial-statements/balance-sheet', arahBaik: 'naik' },
  'Accounts Receivable': { id: 'kpi-ar', route: '/accounts-receivable', arahBaik: 'turun' },
  'Accounts Payable': { id: 'kpi-ap', route: '/accounts-payable', arahBaik: 'turun' },
  'EBITDA': { id: 'kpi-ebitda', route: '/financial-statements/profit-loss', arahBaik: 'naik' },
  'Tax Payable': { id: 'kpi-tax', route: '/tax-compliance', arahBaik: 'turun', warningJikaAda: true },
};

// Urutan render tetap mengikuti layout bento asli (row 1: revenue hero +
// net + gross, row 2: cash + ar + ap + ebitda + tax).
const URUTAN_LABEL = [
  'Total Revenue', 'Net Profit', 'Gross Profit', 'Cash & Bank',
  'Accounts Receivable', 'Accounts Payable', 'EBITDA', 'Tax Payable',
];

// Kartu yang punya padanan di data P&L (useProfitLossData) sehingga bisa
// ditampilkan dalam mode Anggaran / Tahun Sebelumnya. Kartu lain (Cash &
// Bank, AR, AP, Tax Payable) TETAP tampilkan nilai Aktual di semua mode --
// belum ada sumber data Anggaran/Tahun Lalu utk pos neraca ini.
const PL_FIELD_UNTUK_LABEL: Record<string, 'revenue' | 'netProfit' | 'grossProfit' | 'ebitda'> = {
  'Total Revenue': 'revenue',
  'Net Profit': 'netProfit',
  'Gross Profit': 'grossProfit',
  'EBITDA': 'ebitda',
};

function hitungStatus(perubahan: number, arahBaik: 'naik' | 'turun', warningJikaAda?: boolean, nilai?: number) {
  if (warningJikaAda && (nilai || 0) > 0) return 'warning' as const;
  const bagus = arahBaik === 'naik' ? perubahan >= 0 : perubahan <= 0;
  if (perubahan === 0) return 'neutral' as const;
  return bagus ? ('positive' as const) : ('negative' as const);
}

export default function KPIBentoGrid({
  viewMode = 'Actual', branch = 'All Branches', branchId,
}: { viewMode?: OverviewViewMode; branch?: string; branchId?: string }) {
  const router = useRouter();
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const { activeClientId, hydrated } = useActiveClient();

  const [kartu, setKartu] = useState<KartuKpiBackend[] | null>(null);
  // [FIX flash-ke-0] Mulai dari `true`, bukan `false` -- di render pertama
  // kita BELUM TAHU apakah bakal ada client aktif (localStorage belum
  // sempat dibaca), jadi anggap "sedang menentukan/memuat" dulu, supaya
  // skeleton yang tampil (lihat `loading && !kartu` di bawah), bukan
  // kartu kosong bernilai 0.
  const [loading, setLoading] = useState(true);
  const [isSampleData, setIsSampleData] = useState(DEMO_MODE);
  const requestIdRef = useRef(0);

  // ── Data P&L (dipakai utk mode Anggaran & Tahun Sebelumnya pada 4 kartu
  // yg ada padanannya: Total Revenue, Net Profit, Gross Profit, EBITDA) ──
  const { isSampleData: plIsSample, PL_CORE, MONTHLY_PL } = useProfitLossData();
  const anchorYear = new Date().getFullYear();
  const elapsedMonths = plIsSample ? 8 : Math.max(1, MONTHLY_PL.length);

  // [BARU] Anggaran P&L REAL (overview_overview_financial_budget lewat
  // ambilFinancialBudget()), menggantikan konstanta hardcoded BUDGET di
  // src/lib/financialData.tsx -- pola fetch identik prevYearPL di bawah.
  const [budgetData, setBudgetData] = useState<{ revenue: number; grossProfit: number; ebitda: number; netProfit: number; ada_data: boolean } | null>(null);
  const fetchingBudgetRef = useRef(false);
  useEffect(() => {
    if (viewMode !== 'Budget' || !activeClientId || fetchingBudgetRef.current) return;
    fetchingBudgetRef.current = true;
    ambilFinancialBudget(activeClientId, anchorYear, elapsedMonths, branchId)
      .then((res) => { fetchingBudgetRef.current = false; setBudgetData(res?.ada_data ? res : null); })
      .catch(() => { fetchingBudgetRef.current = false; setBudgetData(null); });
  }, [viewMode, activeClientId, anchorYear, elapsedMonths, branchId]);

  const [prevYearPL, setPrevYearPL] = useState<typeof PL_CORE | null>(null);
  const fetchingPrevYearRef = useRef(false);
  useEffect(() => {
    if (viewMode !== 'Previous Year' || plIsSample || !activeClientId || fetchingPrevYearRef.current) return;
    fetchingPrevYearRef.current = true;
    fetchMonthlyPLForYear(activeClientId, anchorYear - 1).then((rows) => {
      fetchingPrevYearRef.current = false;
      if (!rows || rows.length === 0) { setPrevYearPL(null); return; }
      const sliced = rows.slice(0, elapsedMonths);
      const sum = sliced.reduce(
        (acc, r) => ({
          revenue: acc.revenue + r.revenue, netProfit: acc.netProfit + r.netProfit,
          grossProfit: acc.grossProfit + r.grossProfit, ebitda: acc.ebitda + r.ebitda,
        }),
        { revenue: 0, netProfit: 0, grossProfit: 0, ebitda: 0 }
      );
      setPrevYearPL(sum as typeof PL_CORE);
    }).catch(() => { fetchingPrevYearRef.current = false; setPrevYearPL(null); });
  }, [viewMode, plIsSample, activeClientId, anchorYear, elapsedMonths]);

  // Nilai pembanding per field P&L, tergantung viewMode. null = pakai data Aktual biasa (dari backend kpi-bento).
  const plOverride: Record<string, { nilai: number; perubahan_persen: number } | null> = useMemo(() => {
    if (viewMode === 'Actual') return {};
    const result: Record<string, { nilai: number; perubahan_persen: number } | null> = {};
    (Object.keys(PL_FIELD_UNTUK_LABEL) as (keyof typeof PL_FIELD_UNTUK_LABEL)[]).forEach((label) => {
      const field = PL_FIELD_UNTUK_LABEL[label];
      const actualJt = plIsSample
        ? { revenue: 0, netProfit: 0, grossProfit: 0, ebitda: 0 }[field] * elapsedMonths / 8
        : (PL_CORE as any)[field] || 0;
      if (viewMode === 'Budget') {
        if (!budgetData) { result[label] = null; return; } // masih loading / belum ada data anggaran
        const budgetRp = (budgetData as any)[field] || 0;
        const actualRp = actualJt * 1e6;
        result[label] = budgetRp !== 0
          ? { nilai: budgetRp, perubahan_persen: ((actualRp - budgetRp) / budgetRp) * 100 }
          : { nilai: 0, perubahan_persen: 0 };
      } else {
        // Previous Year
        if (plIsSample) {
          const pyJt = actualJt * 0.87;
          result[label] = { nilai: pyJt * 1e6, perubahan_persen: pyJt !== 0 ? ((actualJt - pyJt) / pyJt) * 100 : 0 };
        } else if (prevYearPL) {
          const pyJt = (prevYearPL as any)[field] || 0;
          result[label] = pyJt !== 0
            ? { nilai: pyJt * 1e6, perubahan_persen: ((actualJt - pyJt) / pyJt) * 100 }
            : null;
        } else {
          result[label] = null; // masih loading / tidak ada data tahun lalu
        }
      }
    });
    return result;
  }, [viewMode, plIsSample, PL_CORE, budgetData, elapsedMonths, prevYearPL]);

  useEffect(() => {
    // [FIX flash-ke-0] Belum tahu client aktifnya siapa (context masih
    // baca localStorage) -- jangan simpulkan apa pun dulu, biarkan
    // skeleton loading tetap tampil.
    if (!hydrated) return;
    if (!activeClientId) {
      setKartu(DEMO_MODE ? buatKartuMock() : buatKartuKosong());
      setIsSampleData(DEMO_MODE);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    ambilKpiBento(activeClientId, undefined, branch)
      .then((res: KpiBentoResponse) => {
        if (requestIdRef.current !== requestId) return; // sudah usang
        const ada_data = (res?.kartu || []).some((k) => Math.abs(k.nilai) > 0.01);
        if (!res?.kartu?.length || !ada_data) {
          // Production tidak boleh mengganti data kosong dengan angka contoh.
          // Demo/development tetap mempertahankan mock untuk kebutuhan presentasi.
          setKartu(DEMO_MODE ? buatKartuMock() : buatKartuKosong());
          setIsSampleData(DEMO_MODE);
        } else {
          setKartu(res.kartu);
          setIsSampleData(false);
        }
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setKartu(DEMO_MODE ? buatKartuMock() : buatKartuKosong());
        setIsSampleData(DEMO_MODE);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }, [hydrated, activeClientId, branch]);

  if (loading && !kartu) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={`kpi-skel-${i}`} className={i === 0 ? 'col-span-2' : ''}>
            <KPICardSkeleton />
          </div>
        ))}
      </div>
    );
  }

  const dataKartu = kartu || (DEMO_MODE ? buatKartuMock() : buatKartuKosong());
  const perLabel: Record<string, KartuKpiBackend> = {};
  dataKartu.forEach((k) => { perLabel[k.label] = k; });

  return (
    <div>
      {isSampleData && (
        <p className="text-xs text-muted-foreground mb-2">
          {t('Showing sample data')}
        </p>
      )}
      {viewMode !== 'Actual' && (
        <p className="text-xs text-muted-foreground mb-2">
          {viewMode === 'Budget'
            ? t('Menampilkan nilai Anggaran (YTD) vs Aktual pada 4 kartu P&L — kartu lain tetap Aktual')
            : t('Menampilkan nilai Tahun Lalu (periode sama) vs Aktual pada 4 kartu P&L — kartu lain tetap Aktual')}
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
        {URUTAN_LABEL.map((label) => {
        const data = perLabel[label];
        const cfg = KONFIGURASI_KARTU[label];
        if (!data || !cfg) return null;

        const override = viewMode !== 'Actual' ? plOverride[label] : undefined;
        const isOverridden = override !== undefined;
        const isPendingOverride = viewMode !== 'Actual' && label in PL_FIELD_UNTUK_LABEL && override === null;

        const sparklinePoints = (data.sparkline.length > 1 ? data.sparkline : [data.sparkline[0] || 0, data.sparkline[0] || 0])
          .map((v) => ({ v }));

        const displayNilai = override ? override.nilai : data.nilai;
        const displayPerubahan = override ? override.perubahan_persen : data.perubahan_persen;
        const status = isPendingOverride
          ? ('neutral' as const)
          : hitungStatus(displayPerubahan, cfg.arahBaik, cfg.warningJikaAda, displayNilai);
        const subtitle = isPendingOverride
          ? (viewMode === 'Budget' ? t('Memuat data anggaran...') : t('Memuat data tahun lalu...'))
          : data.margin_persen !== null && data.margin_persen !== undefined
          ? `${t('Margin')} ${data.margin_persen}%`
          : undefined;
        const changePeriod = isOverridden
          ? (viewMode === 'Budget' ? t('vs anggaran') : t('vs tahun lalu'))
          : t('vs prev period');

        const card = (
          <MetricCard
            id={cfg.id}
            label={t(label)}
            value={isPendingOverride ? '—' : formatMoney(displayNilai, currency)}
            change={isPendingOverride ? 0 : displayPerubahan}
            changePeriod={changePeriod}
            sparkline={sparklinePoints}
            status={status}
            subtitle={subtitle}
            onClick={() => router?.push(cfg.route)}
            hero={cfg.hero}
          />
        );

          return cfg.hero ? (
            <div key={label} className="col-span-2">{card}</div>
          ) : (
            <React.Fragment key={label}>{card}</React.Fragment>
          );
        })}
      </div>
    </div>
  );
}