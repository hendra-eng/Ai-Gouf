'use client';

// Store payroll per client aktif, tersambung ke backend (payrollApi.ts).
// - Data dimuat sekali per client (GET /api/v1/management/payroll).
// - Perubahan angka di tabel payroll run (lembur, bonus, dst) langsung tampil
//   (dihitung lokal) lalu disimpan ke server dengan jeda singkat (debounce).
// - Aksi lain (karyawan, status, pengaturan) menunggu server; kalau gagal,
//   pesan error dari backend ditampilkan dan data dimuat ulang.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  DEFAULT_SETTINGS, EMPTY_INPUT,
  type Employee, type LineInput, type PayrollData, type PayrollRun, type PayrollSettings, type RunStatus,
} from './payrollTypes';
import { buildLine, recomputeLine, yearHistory } from './payrollCalc';
import {
  apiCreateEmployee, apiCreateRun, apiDeleteEmployee, apiDeleteRun, apiLoad, apiSaveSettings,
  apiReopenRun, apiSetRunStatus, apiUpdateEmployee, apiUpdateRunLines,
} from './payrollApi';

const SYNC_DELAY_MS = 700;

const emptyData = (): PayrollData => ({ employees: [], runs: [], settings: { ...DEFAULT_SETTINGS } });

export type SyncState = 'idle' | 'saving' | 'error';

export const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function periodLabel(period: string) {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Terjadi kesalahan');

export function usePayrollStore(clientId: string | null) {
  const [data, setDataState] = useState<PayrollData>(emptyData);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [syncFailed, setSyncFailed] = useState(false);

  // dataRef = sumber kebenaran terbaru (dipakai di callback async tanpa stale closure).
  const dataRef = useRef<PayrollData>(data);
  const clientRef = useRef<string | null>(clientId);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const setData = useCallback((next: PayrollData) => { dataRef.current = next; setDataState(next); }, []);

  const track = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setPending(n => n + 1);
    try { const r = await fn(); setSyncFailed(false); return r; }
    catch (e) { setSyncFailed(true); throw e; }
    finally { setPending(n => n - 1); }
  }, []);

  const load = useCallback(async (id: string) => {
    try {
      const d = await apiLoad(id);
      if (clientRef.current !== id) return; // client sudah berganti
      setData(d);
      setLoadError(null);
    } catch (e) {
      if (clientRef.current !== id) return;
      setLoadError(msg(e));
    } finally {
      if (clientRef.current === id) setReady(true);
    }
  }, [setData]);

  useEffect(() => {
    clientRef.current = clientId;
    timers.current.forEach(t => clearTimeout(t));
    timers.current.clear();
    setReady(false); setLoadError(null); setSyncFailed(false);
    setData(emptyData());
    if (!clientId) { setReady(true); return; }
    void load(clientId);
  }, [clientId, load, setData]);

  const reload = useCallback(() => { if (clientId) { setReady(false); void load(clientId); } }, [clientId, load]);

  /** Simpan isi run draft ke server (dipanggil setelah jeda / sebelum ganti status). */
  const pushRun = useCallback(async (runId: string) => {
    const t = timers.current.get(runId);
    if (t) { clearTimeout(t); timers.current.delete(runId); }
    const run = dataRef.current.runs.find(r => r.id === runId);
    if (!run || run.status !== 'draft') return;
    await track(() => apiUpdateRunLines(runId, run.lines));
  }, [track]);

  const scheduleRunSync = useCallback((runId: string) => {
    const old = timers.current.get(runId);
    if (old) clearTimeout(old);
    timers.current.set(runId, setTimeout(() => {
      timers.current.delete(runId);
      pushRun(runId).catch(e => { toast.error(`Gagal menyimpan payroll: ${msg(e)}`); reload(); });
    }, SYNC_DELAY_MS));
  }, [pushRun, reload]);

  // ── Employees ──
  const saveEmployee = useCallback(async (emp: Omit<Employee, 'id'> & { id?: string }): Promise<boolean> => {
    const cid = clientRef.current;
    if (!cid) return false;
    try {
      const { id, ...body } = emp;
      const saved = await track(() => (id ? apiUpdateEmployee(id, body) : apiCreateEmployee(cid, body)));
      const d = dataRef.current;
      setData({
        ...d,
        employees: id ? d.employees.map(e => (e.id === id ? saved : e)) : [...d.employees, saved],
      });
      return true;
    } catch (e) { toast.error(msg(e)); return false; }
  }, [track, setData]);

  const removeEmployee = useCallback(async (id: string): Promise<boolean> => {
    try {
      await track(() => apiDeleteEmployee(id));
      const d = dataRef.current;
      setData({ ...d, employees: d.employees.filter(e => e.id !== id) });
      return true;
    } catch (e) { toast.error(msg(e)); return false; }
  }, [track, setData]);

  // ── Settings ──
  const saveSettings = useCallback(async (s: PayrollSettings): Promise<boolean> => {
    const cid = clientRef.current;
    if (!cid) return false;
    try {
      await track(() => apiSaveSettings(cid, s));
      const d = dataRef.current;
      // run draft dihitung ulang dengan pengaturan baru, lalu disimpan
      const runs = d.runs.map(r => (r.status === 'draft'
        ? { ...r, lines: r.lines.map(l => recomputeLine(l, s, r.period, yearHistory(d.runs, l.employeeId, r.period, r.id))) }
        : r));
      setData({ ...d, settings: s, runs });
      runs.filter(r => r.status === 'draft').forEach(r => scheduleRunSync(r.id));
      return true;
    } catch (e) { toast.error(msg(e)); return false; }
  }, [track, setData, scheduleRunSync]);

  // ── Runs ──
  const createRun = useCallback(async (period: string, payDate: string): Promise<string | null> => {
    const cid = clientRef.current;
    const d = dataRef.current;
    if (!cid || d.runs.some(r => r.period === period)) return null;
    const active = d.employees.filter(e => e.active);
    if (active.length === 0) return null;
    try {
      const lines = active.map(e => buildLine(e, { ...EMPTY_INPUT }, d.settings, period, yearHistory(d.runs, e.id, period)));
      const run = await track(() => apiCreateRun(cid, period, payDate, lines));
      const cur = dataRef.current;
      setData({ ...cur, runs: [...cur.runs, run].sort((a, b) => a.period.localeCompare(b.period)) });
      return run.id;
    } catch (e) { toast.error(msg(e)); return null; }
  }, [track, setData]);

  const updateLineInput = useCallback((runId: string, employeeId: string, patch: Partial<LineInput>) => {
    const d = dataRef.current;
    setData({
      ...d,
      runs: d.runs.map(r => {
        if (r.id !== runId || r.status !== 'draft') return r;
        return {
          ...r,
          lines: r.lines.map(l => {
            if (l.employeeId !== employeeId) return l;
            const next = { ...l, input: { ...l.input, ...patch } };
            return recomputeLine(next, d.settings, r.period, yearHistory(d.runs, employeeId, r.period, r.id));
          }),
        };
      }),
    });
    scheduleRunSync(runId);
  }, [setData, scheduleRunSync]);

  /** Tarik ulang data master karyawan (gaji, PTKP, dll) ke run draft. */
  const refreshRunFromMaster = useCallback((runId: string) => {
    const d = dataRef.current;
    setData({
      ...d,
      runs: d.runs.map(r => {
        if (r.id !== runId || r.status !== 'draft') return r;
        const lines = d.employees.filter(e => e.active).map(e => {
          const old = r.lines.find(l => l.employeeId === e.id);
          return buildLine(e, old?.input ?? { ...EMPTY_INPUT }, d.settings, r.period, yearHistory(d.runs, e.id, r.period, r.id));
        });
        return { ...r, lines };
      }),
    });
    scheduleRunSync(runId);
  }, [setData, scheduleRunSync]);

  const setRunStatus = useCallback(async (runId: string, status: RunStatus): Promise<boolean> => {
    try {
      await pushRun(runId); // pastikan isi terbaru sudah di server sebelum dikunci
      const updated = await track(() => apiSetRunStatus(runId, status));
      const d = dataRef.current;
      setData({ ...d, runs: d.runs.map(r => (r.id === runId ? { ...r, status: updated.status, approvedAt: updated.approvedAt, paidAt: updated.paidAt, history: updated.history } : r)) });
      return true;
    } catch (e) { toast.error(msg(e)); reload(); return false; }
  }, [pushRun, track, setData, reload]);

  /** Mundurkan status satu langkah (dibayar -> disetujui, disetujui -> draft). Alasan wajib; hanya level tinggi. */
  const reopenRun = useCallback(async (runId: string, reason: string): Promise<boolean> => {
    try {
      const updated = await track(() => apiReopenRun(runId, reason));
      const d = dataRef.current;
      setData({ ...d, runs: d.runs.map(r => (r.id === runId ? { ...r, status: updated.status, approvedAt: updated.approvedAt, paidAt: updated.paidAt, history: updated.history } : r)) });
      return true;
    } catch (e) { toast.error(msg(e)); return false; }
  }, [track, setData]);

  const deleteRun = useCallback(async (runId: string): Promise<boolean> => {
    try {
      const t = timers.current.get(runId);
      if (t) { clearTimeout(t); timers.current.delete(runId); }
      await track(() => apiDeleteRun(runId));
      const d = dataRef.current;
      setData({ ...d, runs: d.runs.filter(r => r.id !== runId) });
      return true;
    } catch (e) { toast.error(msg(e)); return false; }
  }, [track, setData]);

  /** Muat 4 karyawan contoh (dibuat sungguhan di database client ini). */
  const loadSample = useCallback(async (): Promise<boolean> => {
    const cid = clientRef.current;
    if (!cid || dataRef.current.employees.length > 0) return false;
    const mk = (n: number, name: string, position: string, base: number, fixed: number, variable: number, ptkp: Employee['ptkp'], npwp: string, join: string): Omit<Employee, 'id'> => ({
      nip: `EMP-${String(n).padStart(3, '0')}`, name, position, department: n < 4 ? 'Finance' : 'Operations', branch: 'Jakarta HQ',
      employmentType: 'PKWTT', joinDate: join, npwp, ptkp, baseSalary: base, fixedAllowance: fixed, variableAllowance: variable,
      bankName: 'BCA', bankAccount: `88000${1000 + n}`, bpjsTk: true, bpjsKes: true, active: true,
    });
    const rows = [
      mk(1, 'Contoh — Rina Pratama', 'Finance Manager', 18000000, 3000000, 1000000, 'K/1', '09.254.294.3-407.000', '2022-03-01'),
      mk(2, 'Contoh — Budi Santoso', 'Senior Accountant', 12000000, 1500000, 800000, 'K/0', '09.254.294.3-407.001', '2023-01-02'),
      mk(3, 'Contoh — Sari Wulandari', 'Tax Staff', 8500000, 1000000, 600000, 'TK/0', '09.254.294.3-407.002', '2024-06-03'),
      mk(4, 'Contoh — Andi Nugroho', 'Admin', 6000000, 500000, 600000, 'TK/0', '', '2025-02-10'),
    ];
    try {
      const created: Employee[] = [];
      for (const r of rows) created.push(await track(() => apiCreateEmployee(cid, r)));
      const d = dataRef.current;
      setData({ ...d, employees: [...d.employees, ...created] });
      return true;
    } catch (e) { toast.error(msg(e)); reload(); return false; }
  }, [track, setData, reload]);

  const syncState: SyncState = pending > 0 ? 'saving' : syncFailed ? 'error' : 'idle';

  return useMemo(() => ({
    ...data, ready, loadError, reload, syncState,
    saveEmployee, removeEmployee, saveSettings,
    createRun, updateLineInput, refreshRunFromMaster, setRunStatus, reopenRun, deleteRun, loadSample,
  }), [data, ready, loadError, reload, syncState, saveEmployee, removeEmployee, saveSettings, createRun, updateLineInput, refreshRunFromMaster, setRunStatus, reopenRun, deleteRun, loadSample]);
}

export type PayrollStore = ReturnType<typeof usePayrollStore>;
