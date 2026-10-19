import React from 'react';
import PayrollContent from './components/PayrollContent';

export const metadata = {
  title: 'Payroll — FinovaAI',
  description: 'Kelola data karyawan, payroll run, BPJS, dan PPh 21 untuk client terpilih.',
};

export default function PayrollPage() {
  return <PayrollContent />;
}
