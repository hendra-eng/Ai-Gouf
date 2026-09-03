'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import MetricCard from '@/components/ui/MetricCard';
import { KPICardSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatMoney, useCurrency } from '@/lib/currency';
import { useLanguage } from '@/lib/language';
import { useActiveClient } from '@/lib/activeClient';
import { ambilKpiBento } from '@/app/agent-ai/lib/api';

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
  'Total Revenue': [820, 945, 880, 1020, 1100, 1050, 1180, 1220].map((v) => v * 1e6),
  'Net Profit': [180, 210, 195, 240, 260, 230, 280, 290].map((v) => v * 1e6),
  'Gross Profit': [380, 420, 395, 450, 490, 460, 510, 530].map((v) => v * 1e6),
  'Cash & Bank': [240, 260, 280, 270, 310, 290, 320, 296].map((v) => v * 1e6),
  'Accounts Receivable': [140, 155, 148, 162, 158, 150, 135, 124].map((v) => v * 1e6),
  'Accounts Payable': [72, 80, 75, 88, 82, 90, 85, 86].map((v) => v * 1e6),
  'EBITDA': [195, 220, 210, 248, 265, 240, 278, 285].map((v) => v * 1e6),
  'Tax Payable': [15, 18, 16, 22, 20, 19, 21, 18].map((v) => v * 1e6),
};

const MOCK_CHANGE: Record<string, number> = {
  'Total Revenue': 12.8,
  'Net Profit': 8.4,
  'Gross Profit': 10.2,
  'Cash & Bank': 5.7,
  'Accounts Receivable': -4.3,
  'Accounts Payable': 3.1,
  'EBITDA': 11.7,
  'Tax Payable': 6.2,
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

// Konfigurasi tampilan per kartu (id, tujuan klik, arah status, hero).
// "arahBaik": 'naik' -> makin tinggi makin bagus (positif = hijau).
//             'turun' -> makin rendah makin bagus (positif = merah/warning).
const KONFIGURASI_KARTU: Record<
  string,
  { id: string; route: string; hero?: boolean; arahBaik: 'naik' | 'turun'; warningJikaAda?: boolean }
> = {
  'Total Revenue': { id: 'kpi-revenue', route: '/financial-statements', hero: true, arahBaik: 'naik' },
  'Net Profit': { id: 'kpi-netprofit', route: '/financial-statements', arahBaik: 'naik' },
  'Gross Profit': { id: 'kpi-grossprofit', route: '/financial-statements', arahBaik: 'naik' },
  'Cash & Bank': { id: 'kpi-cash', route: '/financial-statements', arahBaik: 'naik' },
  'Accounts Receivable': { id: 'kpi-ar', route: '/transactions', arahBaik: 'turun' },
  'Accounts Payable': { id: 'kpi-ap', route: '/transactions', arahBaik: 'turun' },
  'EBITDA': { id: 'kpi-ebitda', route: '/financial-statements', arahBaik: 'naik' },
  'Tax Payable': { id: 'kpi-tax', route: '/transactions', arahBaik: 'turun', warningJikaAda: true },
};

// Urutan render tetap mengikuti layout bento asli (row 1: revenue hero +
// net + gross, row 2: cash + ar + ap + ebitda + tax).
const URUTAN_LABEL = [
  'Total Revenue', 'Net Profit', 'Gross Profit', 'Cash & Bank',
  'Accounts Receivable', 'Accounts Payable', 'EBITDA', 'Tax Payable',
];

function hitungStatus(perubahan: number, arahBaik: 'naik' | 'turun', warningJikaAda?: boolean, nilai?: number) {
  if (warningJikaAda && (nilai || 0) > 0) return 'warning' as const;
  const bagus = arahBaik === 'naik' ? perubahan >= 0 : perubahan <= 0;
  if (perubahan === 0) return 'neutral' as const;
  return bagus ? ('positive' as const) : ('negative' as const);
}

export default function KPIBentoGrid() {
  const router = useRouter();
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const { activeClientId } = useActiveClient();

  const [kartu, setKartu] = useState<KartuKpiBackend[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSampleData, setIsSampleData] = useState(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!activeClientId) {
      setKartu(buatKartuMock());
      setIsSampleData(true);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    ambilKpiBento(activeClientId)
      .then((res: KpiBentoResponse) => {
        if (requestIdRef.current !== requestId) return; // sudah usang
        const ada_data = (res?.kartu || []).some((k) => Math.abs(k.nilai) > 0.01);
        if (!res?.kartu?.length || !ada_data) {
          // Client aktif belum punya jurnal/COA yang menghasilkan angka apa pun --
          // tampilkan data contoh drpd grid kosong semua (sama seperti TransactionsContext).
          setKartu(buatKartuMock());
          setIsSampleData(true);
        } else {
          setKartu(res.kartu);
          setIsSampleData(false);
        }
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setKartu(buatKartuMock());
        setIsSampleData(true);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }, [activeClientId]);

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

  const dataKartu = kartu || buatKartuMock();
  const perLabel: Record<string, KartuKpiBackend> = {};
  dataKartu.forEach((k) => { perLabel[k.label] = k; });

  return (
    <div>
      {isSampleData && (
        <p className="text-xs text-muted-foreground mb-2">
          {t('Showing sample data')}
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
        {URUTAN_LABEL.map((label) => {
        const data = perLabel[label];
        const cfg = KONFIGURASI_KARTU[label];
        if (!data || !cfg) return null;

        const sparklinePoints = (data.sparkline.length > 1 ? data.sparkline : [data.sparkline[0] || 0, data.sparkline[0] || 0])
          .map((v) => ({ v }));
        const status = hitungStatus(data.perubahan_persen, cfg.arahBaik, cfg.warningJikaAda, data.nilai);
        const subtitle = data.margin_persen !== null && data.margin_persen !== undefined
          ? `${t('Margin')} ${data.margin_persen}%`
          : undefined;

        const card = (
          <MetricCard
            id={cfg.id}
            label={t(label)}
            value={formatMoney(data.nilai, currency)}
            change={data.perubahan_persen}
            changePeriod={t('vs prev period')}
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
