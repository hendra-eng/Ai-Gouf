'use client';
import React, { useEffect, useState } from 'react';
import { Building2, Calculator, LayoutDashboard, Receipt, Settings2, Users, Wallet } from 'lucide-react';
import TabNav, { type TabNavItem } from '@/components/ui/TabNav';
import { useActiveClient } from '@/lib/activeClient';
import { usePayrollStore } from '../lib/payrollStore';
import PayrollOverview from './PayrollOverview';
import EmployeesTab from './EmployeesTab';
import PayrollRunTab from './PayrollRunTab';
import TaxBpjsTab from './TaxBpjsTab';
import PayrollSettingsTab from './PayrollSettingsTab';

const TABS: TabNavItem[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'employees', label: 'Employees', icon: Users },
  { key: 'runs', label: 'Payroll Run', icon: Calculator },
  { key: 'tax', label: 'Tax & BPJS', icon: Receipt },
  { key: 'settings', label: 'Settings', icon: Settings2 },
];

export default function PayrollContent() {
  const { activeClientId, activeClientName } = useActiveClient();
  const store = usePayrollStore(activeClientId);
  const [tab, setTab] = useState('overview');

  // Deep link ?tab=employees + perintah suara Neo.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && TABS.some(x => x.key === t)) setTab(t);
  }, []);
  // Perintah suara Neo ("buka tab karyawan di halaman payroll"): bila sudah di halaman ini, pindah tab lewat event (tanpa remount).
  useEffect(() => {
    const h = (e: Event) => {
      const t = (e as CustomEvent).detail?.tab;
      if (t && TABS.some(x => x.key === t)) setTab(t);
    };
    window.addEventListener('neo-tab', h);
    return () => window.removeEventListener('neo-tab', h);
  }, []);

  return (
    <div className="pb-16">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-700 to-emerald-600 text-white shadow-md shadow-slate-700/25">
            <Wallet size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Payroll</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Penggajian, BPJS, dan PPh 21 untuk{' '}
              {activeClientName ? <span className="font-medium text-foreground">{activeClientName}</span> : 'client yang dipilih'}.
            </p>
          </div>
        </div>
      </div>

      {!activeClientId ? (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Building2 size={16} className="flex-shrink-0" />
          Pilih client lewat “Switch Company” di bagian atas untuk mengelola payroll.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-[11px] mb-4">
            {store.syncState === 'saving' && <span className="text-muted-foreground">Menyimpan…</span>}
            {store.syncState === 'idle' && store.ready && !store.loadError && <span className="text-positive">✓ Tersimpan di database</span>}
            {store.syncState === 'error' && <span className="text-negative">Gagal menyimpan — perubahan terakhir mungkin belum tersimpan.</span>}
          </div>
          <TabNav items={TABS} activeKey={tab} onSelect={setTab} className="mb-6" />
          {!store.ready ? (
            <p className="text-sm text-muted-foreground py-10 text-center">Memuat data payroll…</p>
          ) : store.loadError ? (
            <div className="fin-card p-8 text-center">
              <p className="text-sm text-negative mb-3">Gagal memuat data payroll: {store.loadError}</p>
              <button onClick={store.reload} className="fin-btn-secondary">Coba lagi</button>
            </div>
          ) : (
            <>
              {tab === 'overview' && <PayrollOverview store={store} goTo={setTab} />}
              {tab === 'employees' && <EmployeesTab store={store} />}
              {tab === 'runs' && <PayrollRunTab store={store} />}
              {tab === 'tax' && <TaxBpjsTab store={store} />}
              {tab === 'settings' && <PayrollSettingsTab store={store} />}
            </>
          )}
        </>
      )}
    </div>
  );
}