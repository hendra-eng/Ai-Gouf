'use client';

// Klien API Payroll -> backend FastAPI modules/management/payroll_v1.py
// (/api/v1/management/payroll/...). Backend memakai snake_case; di sini
// dipetakan ke tipe frontend (payrollTypes.ts). Auth lewat cookie sesi,
// sama seperti halaman lain (lewat proxy /api di next.config.mjs).

import {
  DEFAULT_SETTINGS,
  type Employee, type PayrollLine, type PayrollRun, type PayrollSettings, type RunStatus, type StatusLogEntry,
} from './payrollTypes';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const BASE = `${API_BASE_URL}/api/v1/management/payroll`;

interface ApiEnvelope<T> { status: 'success' | 'error'; message: string; data: T | null; errors: unknown }

async function baca<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    const detail = (json as { detail?: unknown } | null)?.detail;
    throw new Error(json?.message || (typeof detail === 'string' ? detail : '') || `Request gagal (${res.status})`);
  }
  return json.data as T;
}

const kirim = (method: string, url: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// ── Bentuk data dari backend ──
interface ApiEmployee {
  id: string; nip: string; name: string; position: string; department: string; branch: string;
  employment_type: Employee['employmentType']; join_date: string; npwp: string; ptkp: Employee['ptkp'];
  base_salary: number; fixed_allowance: number; variable_allowance: number;
  bank_name: string; bank_account: string; bpjs_tk: boolean; bpjs_kes: boolean; is_active: boolean;
}
interface ApiRun {
  id: string; period: string; pay_date: string; status: RunStatus; lines: PayrollLine[];
  created_at: string; approved_at: string | null; paid_at: string | null; status_history?: StatusLogEntry[];
}
interface ApiPayroll { employees: ApiEmployee[]; runs: ApiRun[]; settings: Partial<PayrollSettings> | null }

const toEmployee = (e: ApiEmployee): Employee => ({
  id: e.id, nip: e.nip, name: e.name, position: e.position, department: e.department, branch: e.branch,
  employmentType: e.employment_type, joinDate: e.join_date, npwp: e.npwp, ptkp: e.ptkp,
  baseSalary: e.base_salary, fixedAllowance: e.fixed_allowance, variableAllowance: e.variable_allowance,
  bankName: e.bank_name, bankAccount: e.bank_account, bpjsTk: e.bpjs_tk, bpjsKes: e.bpjs_kes, active: e.is_active,
});

const fromEmployee = (e: Omit<Employee, 'id'>) => ({
  nip: e.nip, name: e.name, position: e.position, department: e.department, branch: e.branch,
  employment_type: e.employmentType, join_date: e.joinDate || null, npwp: e.npwp, ptkp: e.ptkp,
  base_salary: e.baseSalary, fixed_allowance: e.fixedAllowance, variable_allowance: e.variableAllowance,
  bank_name: e.bankName, bank_account: e.bankAccount, bpjs_tk: e.bpjsTk, bpjs_kes: e.bpjsKes, is_active: e.active,
});

const toRun = (r: ApiRun): PayrollRun => ({
  id: r.id, period: r.period, payDate: r.pay_date, status: r.status, createdAt: r.created_at,
  approvedAt: r.approved_at ?? undefined, paidAt: r.paid_at ?? undefined, history: r.status_history ?? [], lines: r.lines ?? [],
});

export async function apiLoad(clientId: string) {
  const d = await baca<ApiPayroll>(await fetch(`${BASE}?client_id=${encodeURIComponent(clientId)}`, { cache: 'no-store' }));
  return {
    employees: d.employees.map(toEmployee),
    runs: d.runs.map(toRun),
    settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) } as PayrollSettings,
  };
}

export async function apiSaveSettings(clientId: string, s: PayrollSettings) {
  await baca(await kirim('PUT', `${BASE}/settings?client_id=${encodeURIComponent(clientId)}`, { settings: s }));
}

export async function apiCreateEmployee(clientId: string, e: Omit<Employee, 'id'>): Promise<Employee> {
  return toEmployee(await baca<ApiEmployee>(await kirim('POST', `${BASE}/employees?client_id=${encodeURIComponent(clientId)}`, fromEmployee(e))));
}

export async function apiUpdateEmployee(id: string, e: Omit<Employee, 'id'>): Promise<Employee> {
  return toEmployee(await baca<ApiEmployee>(await kirim('PUT', `${BASE}/employees/${encodeURIComponent(id)}`, fromEmployee(e))));
}

export async function apiDeleteEmployee(id: string) {
  await baca(await kirim('DELETE', `${BASE}/employees/${encodeURIComponent(id)}`));
}

export async function apiCreateRun(clientId: string, period: string, payDate: string, lines: PayrollLine[]): Promise<PayrollRun> {
  return toRun(await baca<ApiRun>(await kirim('POST', `${BASE}/runs?client_id=${encodeURIComponent(clientId)}`, { period, pay_date: payDate, lines })));
}

export async function apiUpdateRunLines(runId: string, lines: PayrollLine[]) {
  await baca(await kirim('PUT', `${BASE}/runs/${encodeURIComponent(runId)}`, { lines }));
}

export async function apiSetRunStatus(runId: string, status: RunStatus): Promise<PayrollRun> {
  return toRun(await baca<ApiRun>(await kirim('PUT', `${BASE}/runs/${encodeURIComponent(runId)}/status`, { status })));
}

export async function apiReopenRun(runId: string, reason: string): Promise<PayrollRun> {
  return toRun(await baca<ApiRun>(await kirim('PUT', `${BASE}/runs/${encodeURIComponent(runId)}/reopen`, { reason })));
}

export async function apiDeleteRun(runId: string) {
  await baca(await kirim('DELETE', `${BASE}/runs/${encodeURIComponent(runId)}`));
}
