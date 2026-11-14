// Ekspor payroll: CSV (rekap & file transfer bank) dan slip gaji (cetak / simpan PDF).
import type { PayrollLine, PayrollRun, PayrollSettings } from './payrollTypes';
import { periodLabel } from './payrollStore';

export const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

function download(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\ufeff' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

export function exportRunCsv(run: PayrollRun) {
  const head = ['NIP', 'Nama', 'Jabatan', 'Departemen', 'Gaji Pokok', 'Tunjangan', 'Lembur', 'Bonus/THR', 'Potongan Absen',
    'Bruto Tunai', 'JHT Karyawan', 'JP Karyawan', 'BPJS Kes Karyawan', 'PPh 21', 'Potongan Lain', 'Take Home Pay',
    'JHT Perusahaan', 'JP Perusahaan', 'JKK', 'JKM', 'BPJS Kes Perusahaan', 'Biaya Perusahaan'];
  const rows = run.lines.map(l => {
    const c = l.computed;
    return [l.nip, l.name, l.position, l.department, c.basic, c.allowance, c.overtime, c.bonus, c.absenceDeduction,
      c.grossCash, c.eeJht, c.eeJp, c.eeKes, c.pph21, c.otherDeduction, c.netPay,
      c.erJht, c.erJp, c.erJkk, c.erJkm, c.erKes, c.companyCost];
  });
  download(`payroll-${run.period}.csv`, [head, ...rows].map(r => r.map(esc).join(',')).join('\n'));
}

export function exportBankTransferCsv(run: PayrollRun) {
  const head = ['NIP', 'Nama', 'Bank', 'No. Rekening', 'Jumlah Transfer', 'Berita'];
  const rows = run.lines.map(l => [l.nip, l.name, l.bankName, l.bankAccount, l.computed.netPay, `Gaji ${periodLabel(run.period)}`]);
  download(`transfer-gaji-${run.period}.csv`, [head, ...rows].map(r => r.map(esc).join(',')).join('\n'));
}

const h = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function printPayslip(line: PayrollLine, run: PayrollRun, s: PayrollSettings) {
  const c = line.computed;
  const row = (label: string, v: number, bold = false) =>
    `<tr${bold ? ' class="b"' : ''}><td>${h(label)}</td><td class="r">${rupiah(v)}</td></tr>`;
  const earnings = [
    row('Gaji Pokok', c.basic),
    c.allowance ? row('Tunjangan', c.allowance) : '',
    c.overtime ? row('Lembur', c.overtime) : '',
    c.bonus ? row('Bonus / THR / Insentif', c.bonus) : '',
    c.absenceDeduction ? row('Potongan Absen', -c.absenceDeduction) : '',
    row('Total Penghasilan', c.grossCash, true),
  ].join('');
  const deductions = [
    c.eeJht ? row('BPJS TK — JHT (2%)', c.eeJht) : '',
    c.eeJp ? row('BPJS TK — JP (1%)', c.eeJp) : '',
    c.eeKes ? row('BPJS Kesehatan (1%)', c.eeKes) : '',
    row(`PPh Pasal 21 (${c.method === 'TER' ? `TER ${c.terCategory} ${c.terRate}%` : 'Perhitungan tahunan'})`, c.pph21),
    c.otherDeduction ? row('Potongan Lain (pinjaman/kasbon)', c.otherDeduction) : '',
    row('Total Potongan', c.eeTotal + c.pph21 + c.otherDeduction, true),
  ].join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Slip Gaji — ${h(line.name)} — ${run.period}</title>
<style>
body{font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#0f172a;margin:32px;font-size:13px}
h1{font-size:18px;margin:0}h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin:20px 0 6px}
.head{display:flex;justify-content:space-between;border-bottom:2px solid #0E2F26;padding-bottom:12px;margin-bottom:14px}
table{width:100%;border-collapse:collapse}td{padding:5px 0;border-bottom:1px solid #e2e8f0}.r{text-align:right;font-variant-numeric:tabular-nums}
.b td{font-weight:700;border-bottom:2px solid #0f172a}.meta td{border:none;padding:2px 0}
.net{margin-top:18px;padding:14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;display:flex;justify-content:space-between;font-size:15px;font-weight:700}
.note{margin-top:18px;color:#64748b;font-size:11px}
</style></head><body>
<div class="head"><div><h1>${h(s.companyName || 'Slip Gaji')}</h1><div style="color:#64748b">Slip Gaji — ${h(periodLabel(run.period))}</div></div>
<div style="text-align:right;color:#64748b">Tanggal bayar<br><b style="color:#0f172a">${h(run.payDate)}</b></div></div>
<table class="meta"><tr><td width="130">Nama</td><td>: ${h(line.name)}</td><td width="130">NIP</td><td>: ${h(line.nip)}</td></tr>
<tr><td>Jabatan</td><td>: ${h(line.position)}</td><td>Departemen</td><td>: ${h(line.department)}</td></tr>
<tr><td>Status PTKP</td><td>: ${h(line.ptkp)}</td><td>NPWP</td><td>: ${h(line.npwp || '—')}</td></tr></table>
<h2>Penghasilan</h2><table>${earnings}</table>
<h2>Potongan</h2><table>${deductions}</table>
<div class="net"><span>Take Home Pay</span><span>${rupiah(c.netPay)}</span></div>
<p class="note">Rekening: ${h(line.bankName || '—')} ${h(line.bankAccount || '')}. Dokumen ini dibuat otomatis oleh sistem dan bersifat rahasia.</p>
<script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body></html>`;
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
