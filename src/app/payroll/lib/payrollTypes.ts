// Tipe data modul Payroll (frontend). Semua nominal dalam Rupiah (IDR).

export type PtkpStatus = 'TK/0' | 'TK/1' | 'TK/2' | 'TK/3' | 'K/0' | 'K/1' | 'K/2' | 'K/3';
export const PTKP_OPTIONS: PtkpStatus[] = ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3'];

export type EmploymentType = 'PKWTT' | 'PKWT';
export type RunStatus = 'draft' | 'approved' | 'paid';

export interface Employee {
  id: string;
  nip: string;
  name: string;
  position: string;
  department: string;
  branch: string;
  employmentType: EmploymentType;
  joinDate: string; // YYYY-MM-DD
  npwp: string;
  ptkp: PtkpStatus;
  baseSalary: number;
  fixedAllowance: number; // tunjangan tetap (jabatan, keluarga, dll)
  variableAllowance: number; // tunjangan tidak tetap (transport, makan) per bulan
  bankName: string;
  bankAccount: string;
  bpjsTk: boolean; // JHT, JP, JKK, JKM
  bpjsKes: boolean; // BPJS Kesehatan
  active: boolean;
}

export interface PayrollSettings {
  // BPJS Ketenagakerjaan
  jhtEmployee: number; // %
  jhtEmployer: number;
  jpEmployee: number;
  jpEmployer: number;
  jpCap: number; // batas upah JP (Rp) -- perbarui tiap tahun
  jkkRate: number; // % (tergantung kelas risiko 0,24 - 1,74)
  jkmRate: number;
  // BPJS Kesehatan
  kesEmployee: number;
  kesEmployer: number;
  kesCap: number; // batas upah Kesehatan (Rp)
  // PPh 21
  biayaJabatanRate: number; // %
  biayaJabatanMonthlyCap: number;
  nonNpwpSurcharge: boolean; // tarif +20% bila tanpa NPWP
  // Akun jurnal (nama akun untuk pratinjau jurnal)
  accSalaryExpense: string;
  accBpjsExpense: string;
  accSalaryPayable: string;
  accTaxPayable: string;
  accBpjsPayable: string;
  accEmployeeReceivable: string;
  // Informasi perusahaan untuk slip gaji
  companyName: string;
  payDay: number; // tanggal gajian
}

export interface LineInput {
  overtime: number;
  bonus: number; // bonus / THR / insentif (masuk penghasilan bruto bulan tsb)
  absenceDeduction: number; // potongan absen / keterlambatan (mengurangi bruto)
  otherDeduction: number; // pinjaman / kasbon (potongan setelah pajak)
}

export interface LineComputed {
  basic: number;
  allowance: number; // tetap + tidak tetap
  overtime: number;
  bonus: number;
  absenceDeduction: number;
  grossCash: number; // gaji yang diterima tunai sebelum potongan
  // porsi perusahaan
  erJht: number;
  erJp: number;
  erJkk: number;
  erJkm: number;
  erKes: number;
  erTotal: number;
  // porsi karyawan
  eeJht: number;
  eeJp: number;
  eeKes: number;
  eeTotal: number;
  taxableGross: number; // bruto untuk PPh 21 (termasuk premi JKK/JKM/Kes ditanggung perusahaan)
  terCategory: 'A' | 'B' | 'C';
  terRate: number; // % (0 bila metode tahunan Desember)
  method: 'TER' | 'ANNUAL';
  pph21: number;
  otherDeduction: number;
  netPay: number; // take home pay
  companyCost: number; // grossCash + erTotal
}

export interface PayrollLine {
  employeeId: string;
  nip: string;
  name: string;
  position: string;
  department: string;
  branch: string;
  npwp: string;
  ptkp: PtkpStatus;
  joinDate: string;
  bankName: string;
  bankAccount: string;
  baseSalary: number;
  fixedAllowance: number;
  variableAllowance: number;
  bpjsTk: boolean;
  bpjsKes: boolean;
  input: LineInput;
  computed: LineComputed;
}

export interface StatusLogEntry {
  at: string;
  by: string | null;
  from: RunStatus;
  to: RunStatus;
  reason: string | null; // terisi untuk buka kembali
}

export interface PayrollRun {
  id: string;
  period: string; // YYYY-MM
  payDate: string; // YYYY-MM-DD
  status: RunStatus;
  createdAt: string;
  approvedAt?: string;
  paidAt?: string;
  history?: StatusLogEntry[];
  lines: PayrollLine[];
}

export interface PayrollData {
  employees: Employee[];
  runs: PayrollRun[];
  settings: PayrollSettings;
}

export const DEFAULT_SETTINGS: PayrollSettings = {
  jhtEmployee: 2,
  jhtEmployer: 3.7,
  jpEmployee: 1,
  jpEmployer: 2,
  jpCap: 10547400,
  jkkRate: 0.24,
  jkmRate: 0.3,
  kesEmployee: 1,
  kesEmployer: 4,
  kesCap: 12000000,
  biayaJabatanRate: 5,
  biayaJabatanMonthlyCap: 500000,
  nonNpwpSurcharge: true,
  accSalaryExpense: '6-1100 Beban Gaji & Tunjangan',
  accBpjsExpense: '6-1200 Beban BPJS (Porsi Perusahaan)',
  accSalaryPayable: '2-1300 Hutang Gaji',
  accTaxPayable: '2-1400 Hutang PPh Pasal 21',
  accBpjsPayable: '2-1500 Hutang BPJS',
  accEmployeeReceivable: '1-1400 Piutang Karyawan',
  companyName: '',
  payDay: 25,
};

export const EMPTY_INPUT: LineInput = { overtime: 0, bonus: 0, absenceDeduction: 0, otherDeduction: 0 };
