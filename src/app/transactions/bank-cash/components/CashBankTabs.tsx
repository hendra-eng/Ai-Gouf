'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ArrowUpRight, ArrowDownLeft, Landmark, Scale, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react';
import TabNav from '@/components/ui/TabNav';

interface Tab {
  id: string;
  label: string;
  href: string;
  description: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

// [BARU] Overview/Bank Feed/Reconciliation ditambahkan supaya Cash & Bank
// mengarah ke arsitektur yang sudah disepakati (fokus rekonsiliasi, bukan
// cuma approval jurnal) — lihat catatan di /areas/transactions-page-audit.md.
// Cash Payment & Cash Receipt TIDAK diubah (sudah tersambung ke backend).
const tabs: Tab[] = [
  {
    id: 'tab-overview',
    icon: LayoutDashboard,
    label: 'Overview',
    href: '/transactions/bank-cash/overview',
    description: 'Ringkasan arus kas, saldo per akun & status rekonsiliasi',
  },
  {
    id: 'tab-cash-payment',
    icon: ArrowUpRight,
    label: 'Cash Payment',
    href: '/transactions/bank-cash/cash-payment',
    description: 'Pembayaran hutang usaha & pajak — diambil otomatis dari halaman Transaksi',
  },
  {
    id: 'tab-cash-receipt',
    icon: ArrowDownLeft,
    label: 'Cash Receipt',
    href: '/transactions/bank-cash/cash-receipt',
    description: 'Pergerakan kas, bank & pendanaan — diambil otomatis dari halaman Transaksi',
  },
  {
    id: 'tab-bank-feed',
    icon: Landmark,
    label: 'Bank Feed',
    href: '/transactions/bank-cash/bank-feed',
    description: 'Import mutasi rekening koran untuk dicocokkan dengan pembukuan',
  },
  {
    id: 'tab-reconciliation',
    icon: Scale,
    label: 'Reconciliation',
    href: '/transactions/bank-cash/reconciliation',
    description: 'Cocokkan mutasi Bank Feed dengan Cash Payment/Cash Receipt — termasuk riwayat yang sudah cocok',
  },
  {
    id: 'tab-journal-preview',
    icon: Eye,
    label: 'Journal Preview',
    href: '/transactions/bank-cash/journal-preview',
    description: 'Lihat bagaimana transaksi kas & bank diubah menjadi jurnal akuntansi',
  },
  {
    id: 'tab-exceptions',
    icon: AlertTriangle,
    label: 'Exceptions',
    href: '/transactions/bank-cash/exceptions',
    description: 'Kelola dan tindak lanjuti transaksi kas & bank yang memerlukan review',
  },
  {
    id: 'tab-posted',
    icon: CheckCircle2,
    label: 'Posted',
    href: '/transactions/bank-cash/posted',
    description: 'Jurnal kas & bank yang sudah diposting ke buku besar',
  },
];

export default function CashBankTabs() {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const activeTab = tabs.find((tab) => isActive(tab.href)) ?? tabs[0];

  return (
    <div className="mb-4">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Cash & Bank</h1>
      <p className="text-sm text-muted-foreground mt-0.5">{activeTab.description}</p>

      <TabNav
        className="mt-4"
        activeKey={activeTab.id}
        items={tabs.map(t => ({ key: t.id, label: t.label, href: t.href, icon: t.icon }))}
      />
    </div>
  );
}