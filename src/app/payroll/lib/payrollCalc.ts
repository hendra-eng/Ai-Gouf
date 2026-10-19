// Mesin hitung payroll Indonesia: BPJS + PPh 21 (TER bulanan Jan-Nov, metode tahunan Desember).
// Dasar: PP 58/2023 & PMK 168/2023 (berlaku 1 Jan 2024). Tarif/batas upah BPJS dapat
// diubah di tab Settings karena berubah berkala -- selalu cek ulang ke regulasi terbaru.

import type {
  Employee, LineComputed, LineInput, PayrollLine, PayrollRun, PayrollSettings, PtkpStatus,
} from './payrollTypes';

type TerTable = [number, number][]; // [batas atas penghasilan bruto bulanan, tarif %]
const INF = Number.POSITIVE_INFINITY;

const TER_A: TerTable = [
  [5400000, 0], [5650000, 0.25], [5950000, 0.5], [6300000, 0.75], [6750000, 1], [7500000, 1.25],
  [8550000, 1.5], [9650000, 1.75], [10050000, 2], [10350000, 2.25], [10700000, 2.5], [11050000, 3],
  [11600000, 3.5], [12500000, 4], [13750000, 5], [15100000, 6], [16950000, 7], [19750000, 8],
  [24150000, 9], [26450000, 10], [28000000, 11], [30050000, 12], [32400000, 13], [35400000, 14],
  [39100000, 15], [43850000, 16], [47800000, 17], [51400000, 18], [56300000, 19], [62200000, 20],
  [68600000, 21], [77500000, 22], [89000000, 23], [103000000, 24], [125000000, 25], [157000000, 26],
  [206000000, 27], [337000000, 28], [454000000, 29], [550000000, 30], [695000000, 31], [910000000, 32],
  [1400000000, 33], [INF, 34],
];

const TER_B: TerTable = [
  [6200000, 0], [6500000, 0.25], [6850000, 0.5], [7300000, 0.75], [9200000, 1], [10750000, 1.5],
  [11250000, 2], [11600000, 2.5], [12600000, 3], [13600000, 4], [14950000, 5], [16400000, 6],
  [18450000, 7], [21850000, 8], [26000000, 9], [27700000, 10], [29350000, 11], [31450000, 12],
  [33950000, 13], [37100000, 14], [41100000, 15], [45800000, 16], [49500000, 17], [53800000, 18],
  [58500000, 19], [64000000, 20], [71000000, 21], [80000000, 22], [93000000, 23], [109000000, 24],
  [129000000, 25], [163000000, 26], [211000000, 27], [374000000, 28], [459000000, 29], [565000000, 30],
  [705000000, 31], [956000000, 32], [1405000000, 33], [INF, 34],
];

const TER_C: TerTable = [
  [6600000, 0], [6950000, 0.25], [7350000, 0.5], [7800000, 0.75], [8850000, 1], [9800000, 1.25],
  [10950000, 1.5], [11200000, 1.75], [12050000, 2], [12950000, 3], [14150000, 4], [15550000, 5],
  [17050000, 6], [19500000, 7], [22700000, 8], [26600000, 9], [28100000, 10], [30100000, 11],
  [32600000, 12], [35400000, 13], [38900000, 14], [43000000, 15], [47400000, 16], [51200000, 17],
  [55800000, 18], [60400000, 19], [66700000, 20], [74500000, 21], [83200000, 22], [95600000, 23],
  [110000000, 24], [134000000, 25], [169000000, 26], [221000000, 27], [390000000, 28], [463000000, 29],
  [561000000, 30], [709000000, 31], [965000000, 32], [1419000000, 33], [INF, 34],
];

export function terCategory(ptkp: PtkpStatus): 'A' | 'B' | 'C' {
  if (ptkp === 'TK/0' || ptkp === 'TK/1') return 'A';
  if (ptkp === 'K/2' || ptkp === 'K/3') return 'C';
  return 'B'; // TK/2, TK/3, K/0, K/1
}

export function terRate(cat: 'A' | 'B' | 'C', monthlyGross: number): number {
  const table = cat === 'A' ? TER_A : cat === 'B' ? TER_B : TER_C;
  for (const [limit, rate] of table) if (monthlyGross <= limit) return rate;
  return 34;
}

/** PTKP tahunan: TK/0 = 54 jt, +4,5 jt untuk status kawin & tiap tanggungan (maks 3). */
export function annualPtkp(ptkp: PtkpStatus): number {
  const married = ptkp.startsWith('K/');
  const dependents = Number(ptkp.split('/')[1] || 0);
  return 54000000 + (married ? 4500000 : 0) + dependents * 4500000;
}

/** Tarif progresif Pasal 17 UU PPh (setahun). */
export function progressiveTax(pkp: number): number {
  const layers: [number, number][] = [[60000000, 0.05], [190000000, 0.15], [250000000, 0.25], [4500000000, 0.3], [INF, 0.35]];
  let remaining = pkp;
  let tax = 0;
  for (const [size, rate] of layers) {
    if (remaining <= 0) break;
    const part = Math.min(remaining, size);
    tax += part * rate;
    remaining -= part;
  }
  return Math.floor(tax);
}

const r0 = (n: number) => Math.round(n);

export interface YearHistory {
  priorTaxableGross: number;
  priorPph21: number;
  priorEmployeePension: number; // JHT + JP porsi karyawan
  priorMonths: number;
}

/** Kumpulkan data masa pajak sebelumnya (tahun yang sama) dari run non-draft sebelum `period`. */
export function yearHistory(runs: PayrollRun[], employeeId: string, period: string, excludeRunId?: string): YearHistory {
  const year = period.slice(0, 4);
  const h: YearHistory = { priorTaxableGross: 0, priorPph21: 0, priorEmployeePension: 0, priorMonths: 0 };
  for (const run of runs) {
    if (run.id === excludeRunId) continue;
    if (run.period.slice(0, 4) !== year || run.period >= period) continue;
    if (run.status === 'draft') continue;
    const l = run.lines.find(x => x.employeeId === employeeId);
    if (!l) continue;
    h.priorTaxableGross += l.computed.taxableGross;
    h.priorPph21 += l.computed.pph21;
    h.priorEmployeePension += l.computed.eeJht + l.computed.eeJp;
    h.priorMonths += 1;
  }
  return h;
}

export function computeLine(
  emp: Pick<Employee, 'baseSalary' | 'fixedAllowance' | 'variableAllowance' | 'ptkp' | 'npwp' | 'joinDate' | 'bpjsTk' | 'bpjsKes'>,
  input: LineInput,
  s: PayrollSettings,
  period: string,
  history: YearHistory,
): LineComputed {
  const basic = emp.baseSalary;
  const allowance = emp.fixedAllowance + emp.variableAllowance;
  const overtime = input.overtime;
  const bonus = input.bonus;
  const absenceDeduction = input.absenceDeduction;
  const grossCash = Math.max(0, basic + allowance + overtime + bonus - absenceDeduction);

  // Upah dasar BPJS = gaji pokok + tunjangan tetap
  const wage = basic + emp.fixedAllowance;
  const jpBase = Math.min(wage, s.jpCap);
  const kesBase = Math.min(wage, s.kesCap);

  const erJht = emp.bpjsTk ? r0(wage * s.jhtEmployer / 100) : 0;
  const erJp = emp.bpjsTk ? r0(jpBase * s.jpEmployer / 100) : 0;
  const erJkk = emp.bpjsTk ? r0(wage * s.jkkRate / 100) : 0;
  const erJkm = emp.bpjsTk ? r0(wage * s.jkmRate / 100) : 0;
  const erKes = emp.bpjsKes ? r0(kesBase * s.kesEmployer / 100) : 0;
  const eeJht = emp.bpjsTk ? r0(wage * s.jhtEmployee / 100) : 0;
  const eeJp = emp.bpjsTk ? r0(jpBase * s.jpEmployee / 100) : 0;
  const eeKes = emp.bpjsKes ? r0(kesBase * s.kesEmployee / 100) : 0;

  const erTotal = erJht + erJp + erJkk + erJkm + erKes;
  const eeTotal = eeJht + eeJp + eeKes;

  // Premi JKK, JKM & Kesehatan yang dibayar pemberi kerja = penghasilan bruto (objek PPh 21).
  const taxableGross = grossCash + erJkk + erJkm + erKes;
  const cat = terCategory(emp.ptkp);
  const month = Number(period.slice(5, 7));
  const surcharge = !emp.npwp.trim() && s.nonNpwpSurcharge ? 1.2 : 1;

  let pph21 = 0;
  let method: 'TER' | 'ANNUAL' = 'TER';
  let rate = 0;

  if (month === 12) {
    // Masa pajak terakhir: hitung ulang setahun pakai tarif Pasal 17, kurangi PPh yang sudah dipotong.
    method = 'ANNUAL';
    const joinYear = emp.joinDate ? Number(emp.joinDate.slice(0, 4)) : 0;
    const periodYear = Number(period.slice(0, 4));
    const monthsWorked = joinYear === periodYear ? Math.max(1, 12 - Number(emp.joinDate.slice(5, 7)) + 1) : 12;
    const annualGross = history.priorTaxableGross + taxableGross;
    const biayaJabatan = Math.min(annualGross * s.biayaJabatanRate / 100, s.biayaJabatanMonthlyCap * monthsWorked);
    const pension = history.priorEmployeePension + eeJht + eeJp;
    const neto = annualGross - biayaJabatan - pension;
    const ptkp = (annualPtkp(emp.ptkp) * monthsWorked) / 12;
    const pkp = Math.max(0, Math.floor((neto - ptkp) / 1000) * 1000);
    const annualTax = r0(progressiveTax(pkp) * surcharge);
    pph21 = Math.max(0, annualTax - history.priorPph21);
  } else {
    rate = terRate(cat, taxableGross);
    pph21 = r0(taxableGross * rate / 100 * surcharge);
  }

  const otherDeduction = input.otherDeduction;
  const netPay = grossCash - eeTotal - pph21 - otherDeduction;

  return {
    basic, allowance, overtime, bonus, absenceDeduction, grossCash,
    erJht, erJp, erJkk, erJkm, erKes, erTotal,
    eeJht, eeJp, eeKes, eeTotal,
    taxableGross, terCategory: cat, terRate: rate, method, pph21,
    otherDeduction, netPay, companyCost: grossCash + erTotal,
  };
}

export function buildLine(emp: Employee, input: LineInput, s: PayrollSettings, period: string, history: YearHistory): PayrollLine {
  return {
    employeeId: emp.id, nip: emp.nip, name: emp.name, position: emp.position,
    department: emp.department, branch: emp.branch, npwp: emp.npwp, ptkp: emp.ptkp,
    joinDate: emp.joinDate, bankName: emp.bankName, bankAccount: emp.bankAccount,
    baseSalary: emp.baseSalary, fixedAllowance: emp.fixedAllowance, variableAllowance: emp.variableAllowance,
    bpjsTk: emp.bpjsTk, bpjsKes: emp.bpjsKes,
    input, computed: computeLine(emp, input, s, period, history),
  };
}

export function recomputeLine(line: PayrollLine, s: PayrollSettings, period: string, history: YearHistory): PayrollLine {
  return { ...line, computed: computeLine(line, line.input, s, period, history) };
}

export interface RunTotals {
  headcount: number;
  grossCash: number;
  erTotal: number;
  eeTotal: number;
  pph21: number;
  otherDeduction: number;
  netPay: number;
  companyCost: number;
  bpjsPayable: number;
  erJht: number; erJp: number; erJkk: number; erJkm: number; erKes: number;
  eeJht: number; eeJp: number; eeKes: number;
}

export function runTotals(lines: PayrollLine[]): RunTotals {
  const t: RunTotals = {
    headcount: lines.length, grossCash: 0, erTotal: 0, eeTotal: 0, pph21: 0, otherDeduction: 0, netPay: 0,
    companyCost: 0, bpjsPayable: 0, erJht: 0, erJp: 0, erJkk: 0, erJkm: 0, erKes: 0, eeJht: 0, eeJp: 0, eeKes: 0,
  };
  for (const { computed: c } of lines) {
    t.grossCash += c.grossCash; t.erTotal += c.erTotal; t.eeTotal += c.eeTotal; t.pph21 += c.pph21;
    t.otherDeduction += c.otherDeduction; t.netPay += c.netPay; t.companyCost += c.companyCost;
    t.erJht += c.erJht; t.erJp += c.erJp; t.erJkk += c.erJkk; t.erJkm += c.erJkm; t.erKes += c.erKes;
    t.eeJht += c.eeJht; t.eeJp += c.eeJp; t.eeKes += c.eeKes;
  }
  t.bpjsPayable = t.erTotal + t.eeTotal;
  return t;
}

export interface JournalLine { account: string; debit: number; credit: number; memo: string }

/** Pratinjau jurnal penggajian (seimbang: Debit = Kredit). */
export function buildJournal(run: PayrollRun, s: PayrollSettings): JournalLine[] {
  const t = runTotals(run.lines);
  const lines: JournalLine[] = [
    { account: s.accSalaryExpense, debit: t.grossCash, credit: 0, memo: `Gaji & tunjangan ${run.period}` },
    { account: s.accBpjsExpense, debit: t.erTotal, credit: 0, memo: `BPJS porsi perusahaan ${run.period}` },
    { account: s.accSalaryPayable, debit: 0, credit: t.netPay, memo: 'Gaji bersih yang harus dibayar' },
    { account: s.accTaxPayable, debit: 0, credit: t.pph21, memo: 'PPh Pasal 21 dipotong' },
    { account: s.accBpjsPayable, debit: 0, credit: t.bpjsPayable, memo: 'BPJS porsi karyawan + perusahaan' },
  ];
  if (t.otherDeduction > 0) {
    lines.push({ account: s.accEmployeeReceivable, debit: 0, credit: t.otherDeduction, memo: 'Potongan pinjaman / kasbon' });
  }
  return lines.filter(l => l.debit !== 0 || l.credit !== 0);
}
