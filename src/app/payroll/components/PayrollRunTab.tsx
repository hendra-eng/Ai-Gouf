'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, BookOpen, CheckCircle2, Download, FileText, Landmark, Plus, RefreshCcw, Trash2, Undo2, Wallet } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import StatusBadge from '@/components/ui/StatusBadge';
import { MoneyInput, Modal, SectionCard, TD, TH } from './payrollUi';
import { currentPeriod, periodLabel, type PayrollStore } from '../lib/payrollStore';
import { buildJournal, runTotals } from '../lib/payrollCalc';
import { exportBankTransferCsv, exportRunCsv, printPayslip, rupiah } from '../lib/payrollExport';
import type { PayrollRun, RunStatus } from '../lib/payrollTypes';

const STATUS: Record<RunStatus, { label: string; variant: 'neutral' | 'warning' | 'positive' }> = {
  draft: { label: 'Draft', variant: 'neutral' },
  approved: { label: 'Disetujui', variant: 'warning' },
  paid: { label: 'Dibayar', variant: 'positive' },
};

const STEPS: RunStatus[] = ['draft', 'approved', 'paid'];

export default function PayrollRunTab({ store }: { store: PayrollStore }) {
  const { runs, employees, settings } = store;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [showReopen, setShowReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopening, setReopening] = useState(false);
  const [newPeriod, setNewPeriod] = useState(currentPeriod());
  const [newPayDate, setNewPayDate] = useState('');

  const ordered = useMemo(() => [...runs].sort((a, b) => b.period.localeCompare(a.period)), [runs]);
  const selected: PayrollRun | null = ordered.find(r => r.id === selectedId) ?? ordered[0] ?? null;

  useEffect(() => { if (!selectedId && ordered[0]) setSelectedId(ordered[0].id); }, [ordered, selectedId]);

  const defaultPayDate = (period: string) => {
    const [y, m] = period.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return `${period}-${String(Math.min(settings.payDay, last)).padStart(2, '0')}`;
  };

  const openNew = () => { setNewPeriod(currentPeriod()); setNewPayDate(defaultPayDate(currentPeriod())); setShowNew(true); };

  const create = async () => {
    if (employees.filter(e => e.active).length === 0) return toast.error('Belum ada karyawan aktif');
    if (runs.some(r => r.period === newPeriod)) return toast.error(`Payroll ${periodLabel(newPeriod)} sudah ada`);
    const id = await store.createRun(newPeriod, newPayDate || defaultPayDate(newPeriod));
    if (!id) return; // error sudah ditampilkan store
    setSelectedId(id);
    toast.success(`Payroll ${periodLabel(newPeriod)} dibuat`);
    setShowNew(false);
  };

  if (runs.length === 0) {
    return (
      <>
        <div className="fin-card">
          <EmptyState
            icon={Wallet} title="Belum ada payroll run"
            description={employees.length ? 'Buat payroll run untuk satu periode. Gaji, BPJS, dan PPh 21 dihitung otomatis dari data karyawan.' : 'Tambahkan karyawan dulu di tab Employees, lalu buat payroll run pertama.'}
            action={employees.length ? { label: 'Buat payroll run', onClick: openNew } : undefined}
          />
        </div>
        {showNew && <NewRunModal {...{ newPeriod, setNewPeriod, newPayDate, setNewPayDate, defaultPayDate, create, onClose: () => setShowNew(false) }} />}
      </>
    );
  }

  const t = selected ? runTotals(selected.lines) : null;
  const editable = selected?.status === 'draft';
  const stepIdx = selected ? STEPS.indexOf(selected.status) : 0;
  const journal = selected ? buildJournal(selected, settings) : [];
  const totDebit = journal.reduce((s, l) => s + l.debit, 0);
  const totCredit = journal.reduce((s, l) => s + l.credit, 0);

  const approve = async () => {
    if (!selected) return;
    if (await store.setRunStatus(selected.id, 'approved')) toast.success('Payroll disetujui — angka dikunci');
  };
  const markPaid = async () => {
    if (!selected) return;
    if (await store.setRunStatus(selected.id, 'paid')) toast.success('Payroll ditandai sudah dibayar');
  };
  const reopen = async () => {
    if (!selected) return;
    if (reopenReason.trim().length < 5) return toast.error('Alasan minimal 5 karakter');
    setReopening(true);
    const ok = await store.reopenRun(selected.id, reopenReason.trim());
    setReopening(false);
    if (!ok) return; // pesan error (mis. level akses) sudah ditampilkan store
    toast.success(selected.status === 'paid' ? 'Pembayaran dibatalkan — status kembali ke Disetujui' : 'Payroll dikembalikan ke Draft — angka bisa diedit lagi');
    setShowReopen(false);
    setReopenReason('');
  };

  const del = async () => {
    if (!selected || !window.confirm(`Hapus draft payroll ${periodLabel(selected.period)}?`)) return;
    if (!(await store.deleteRun(selected.id))) return;
    setSelectedId(null);
    toast.success('Draft dihapus');
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          {ordered.map(r => (
            <button
              key={r.id} onClick={() => setSelectedId(r.id)}
              className={`px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors ${
                r.id === selected?.id ? 'bg-nav text-white border-transparent' : 'bg-card border-border text-foreground hover:border-primary/50'
              }`}
            >
              {periodLabel(r.period)} <span className={`ml-1 text-[10px] ${r.id === selected?.id ? 'text-white/70' : 'text-muted-foreground'}`}>• {STATUS[r.status].label}</span>
            </button>
          ))}
        </div>
        <button onClick={openNew} className="fin-btn-primary flex items-center gap-1.5"><Plus size={14} /> Payroll Run Baru</button>
      </div>

      {selected && t && (
        <>
          {/* Stepper status */}
          <div className="fin-card p-4 mb-5 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[260px]">
              {STEPS.map((s, i) => (
                <React.Fragment key={s}>
                  <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center ${i <= stepIdx ? 'bg-positive text-white' : 'bg-muted text-muted-foreground'}`}>
                      {i < stepIdx ? <CheckCircle2 size={14} /> : i + 1}
                    </span>
                    <span className={`text-[12px] ${i <= stepIdx ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{STATUS[s].label}</span>
                  </div>
                  {i < STEPS.length - 1 && <div className={`h-px flex-1 min-w-[24px] ${i < stepIdx ? 'bg-positive' : 'bg-border'}`} />}
                </React.Fragment>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground">Tanggal bayar: <b className="text-foreground">{selected.payDate}</b></div>
            <div className="flex items-center gap-2 flex-wrap">
              {editable && (
                <>
                  <button onClick={() => { store.refreshRunFromMaster(selected.id); toast.success('Data master ditarik ulang'); }} className="fin-btn-secondary flex items-center gap-1.5"><RefreshCcw size={13} /> Tarik ulang master</button>
                  <button onClick={del} className="fin-btn-secondary flex items-center gap-1.5 !text-negative"><Trash2 size={13} /> Hapus</button>
                  <button onClick={approve} className="fin-btn-primary">Setujui Payroll</button>
                </>
              )}
              {selected.status === 'approved' && (
                <>
                  <button onClick={() => setShowReopen(true)} className="fin-btn-secondary flex items-center gap-1.5"><Undo2 size={13} /> Kembalikan ke Draft</button>
                  <button onClick={markPaid} className="fin-btn-primary flex items-center gap-1.5"><Landmark size={14} /> Tandai Sudah Dibayar</button>
                </>
              )}
              {selected.status === 'paid' && (
                <button onClick={() => setShowReopen(true)} className="fin-btn-secondary flex items-center gap-1.5"><Undo2 size={13} /> Batalkan Pembayaran</button>
              )}
            </div>
          </div>

          {/* Ringkasan */}
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-5">
            {[
              ['Karyawan', String(t.headcount)],
              ['Gaji Bruto', rupiah(t.grossCash)],
              ['PPh 21', rupiah(t.pph21)],
              ['Take Home Pay', rupiah(t.netPay)],
              ['Biaya Perusahaan', rupiah(t.companyCost)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-border bg-card p-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{k}</div>
                <div className="number-display font-bold text-[15px] text-foreground mt-1 truncate">{v}</div>
              </div>
            ))}
          </div>

          <SectionCard
            title={`Rincian Payroll — ${periodLabel(selected.period)}`}
            subtitle={editable ? 'Isi lembur, bonus, dan potongan per karyawan. Pajak & BPJS dihitung ulang otomatis.' : 'Payroll sudah dikunci (read-only).'}
            actions={
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => exportRunCsv(selected)} className="fin-btn-secondary flex items-center gap-1.5"><Download size={13} /> Rekap CSV</button>
                <button onClick={() => exportBankTransferCsv(selected)} className="fin-btn-secondary flex items-center gap-1.5"><Landmark size={13} /> File Transfer Bank</button>
                <button onClick={() => setShowJournal(v => !v)} className="fin-btn-secondary flex items-center gap-1.5"><BookOpen size={13} /> {showJournal ? 'Sembunyikan' : 'Lihat'} Jurnal</button>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {['Karyawan', 'Gaji + Tunjangan', 'Lembur', 'Bonus / THR', 'Pot. Absen', 'Bruto', 'BPJS Karyawan', 'PPh 21', 'Pot. Lain', 'Take Home Pay', ''].map(c => <th key={c} className={TH}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map(l => {
                    const c = l.computed;
                    return (
                      <tr key={l.employeeId} className="border-b border-border hover:bg-muted/30 transition-colors">
                        <td className={TD}>
                          <div className="font-medium text-foreground">{l.name}</div>
                          <div className="text-[11px] text-muted-foreground">{l.nip} • {l.ptkp}</div>
                        </td>
                        <td className={`${TD} financial-value`}>{rupiah(c.basic + c.allowance)}</td>
                        <td className="px-2 py-2 w-32"><MoneyInput value={l.input.overtime} disabled={!editable} onCommit={n => store.updateLineInput(selected.id, l.employeeId, { overtime: n })} /></td>
                        <td className="px-2 py-2 w-32"><MoneyInput value={l.input.bonus} disabled={!editable} onCommit={n => store.updateLineInput(selected.id, l.employeeId, { bonus: n })} /></td>
                        <td className="px-2 py-2 w-32"><MoneyInput value={l.input.absenceDeduction} disabled={!editable} onCommit={n => store.updateLineInput(selected.id, l.employeeId, { absenceDeduction: n })} /></td>
                        <td className={`${TD} financial-value font-medium`}>{rupiah(c.grossCash)}</td>
                        <td className={`${TD} financial-value text-muted-foreground`}>{rupiah(c.eeTotal)}</td>
                        <td className={TD}>
                          <div className="financial-value">{rupiah(c.pph21)}</div>
                          <div className="text-[10px] text-muted-foreground">{c.method === 'TER' ? `TER ${c.terCategory} • ${c.terRate}%` : 'Tahunan (Des)'}</div>
                        </td>
                        <td className="px-2 py-2 w-32"><MoneyInput value={l.input.otherDeduction} disabled={!editable} onCommit={n => store.updateLineInput(selected.id, l.employeeId, { otherDeduction: n })} /></td>
                        <td className={`${TD} financial-value font-bold text-foreground`}>{rupiah(c.netPay)}</td>
                        <td className={TD}>
                          <button
                            onClick={() => { if (!printPayslip(l, selected, settings)) toast.error('Pop-up diblokir browser. Izinkan pop-up untuk mencetak slip.'); }}
                            className="p-1.5 rounded hover:bg-muted" title="Cetak slip gaji"
                          ><FileText size={14} className="text-muted-foreground" /></button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/40 font-semibold">
                    <td className={TD}>Total ({t.headcount})</td>
                    <td colSpan={4} />
                    <td className={`${TD} financial-value`}>{rupiah(t.grossCash)}</td>
                    <td className={`${TD} financial-value`}>{rupiah(t.eeTotal)}</td>
                    <td className={`${TD} financial-value`}>{rupiah(t.pph21)}</td>
                    <td className={`${TD} financial-value`}>{rupiah(t.otherDeduction)}</td>
                    <td className={`${TD} financial-value`}>{rupiah(t.netPay)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t border-border flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
              <StatusBadge label={STATUS[selected.status].label} variant={STATUS[selected.status].variant} dot />
              PPh 21 bulan Jan–Nov memakai TER (PMK 168/2023); Desember dihitung ulang setahun dengan tarif Pasal 17.
            </div>
          </SectionCard>

          {showJournal && (
            <SectionCard title="Pratinjau Jurnal Penggajian" subtitle="Belum diposting otomatis ke Journal Entry — nama akun dapat diatur di tab Settings">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead><tr className="border-b border-border bg-muted/40">{['Akun', 'Keterangan', 'Debit', 'Kredit'].map(c => <th key={c} className={TH}>{c}</th>)}</tr></thead>
                  <tbody>
                    {journal.map((j, i) => (
                      <tr key={`j-${i}`} className="border-b border-border">
                        <td className={`${TD} text-foreground ${j.credit > 0 ? 'pl-10' : ''}`}>{j.account}</td>
                        <td className={`${TD} text-muted-foreground`}>{j.memo}</td>
                        <td className={`${TD} financial-value`}>{j.debit ? rupiah(j.debit) : '—'}</td>
                        <td className={`${TD} financial-value`}>{j.credit ? rupiah(j.credit) : '—'}</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/40 font-semibold">
                      <td className={TD} colSpan={2}>Total {Math.round(totDebit) === Math.round(totCredit) ? <span className="text-positive ml-2 font-medium">✓ Seimbang</span> : <span className="text-negative ml-2">Tidak seimbang</span>}</td>
                      <td className={`${TD} financial-value`}>{rupiah(totDebit)}</td>
                      <td className={`${TD} financial-value`}>{rupiah(totCredit)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </>
      )}

      {selected && (selected.history?.length ?? 0) > 0 && (
        <SectionCard title="Riwayat Status" subtitle="Catatan perubahan status payroll ini, termasuk pembukaan kembali">
          <ul className="p-5 space-y-2 text-[12px]">
            {[...(selected.history ?? [])].reverse().map((h, i) => (
              <li key={`h-${i}`} className="flex items-start gap-3">
                <span className="text-muted-foreground whitespace-nowrap">{new Date(h.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <span className="text-foreground">
                  {STATUS[h.from].label} → <b>{STATUS[h.to].label}</b>
                  {h.reason && <span className="text-muted-foreground"> — alasan: {h.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {showReopen && selected && (
        <Modal
          title={selected.status === 'paid' ? 'Batalkan Pembayaran' : 'Kembalikan ke Draft'}
          subtitle={`Payroll ${periodLabel(selected.period)}`}
          onClose={() => { setShowReopen(false); setReopenReason(''); }}
          footer={<>
            <button onClick={() => { setShowReopen(false); setReopenReason(''); }} className="fin-btn-secondary">Batal</button>
            <button onClick={reopen} disabled={reopening} className="fin-btn-primary disabled:opacity-60">{reopening ? 'Memproses…' : 'Ya, Kembalikan'}</button>
          </>}
        >
          <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
            <span>
              {selected.status === 'paid'
                ? 'Status mundur ke Disetujui. Ini hanya mengubah catatan di sistem — jika uang sudah ditransfer, urus pengembaliannya secara terpisah.'
                : 'Status mundur ke Draft: angka akan terbuka dan bisa diedit lagi, lalu harus disetujui ulang. Slip gaji yang sudah dibagikan perlu dicetak ulang.'}
              {' '}Hanya akun level Tahap 5 ke atas yang diizinkan, dan perubahan ini dicatat.
            </span>
          </div>
          <label className="block">
            <span className="block text-[11px] font-semibold text-muted-foreground mb-1">Alasan (wajib, minimal 5 karakter)</span>
            <textarea
              className="input-base min-h-[88px]" value={reopenReason} maxLength={500}
              onChange={e => setReopenReason(e.target.value)} placeholder="Contoh: salah input nominal bonus Hendra"
            />
          </label>
        </Modal>
      )}

      {showNew && <NewRunModal {...{ newPeriod, setNewPeriod, newPayDate, setNewPayDate, defaultPayDate, create, onClose: () => setShowNew(false) }} />}
    </>
  );
}

function NewRunModal({ newPeriod, setNewPeriod, newPayDate, setNewPayDate, defaultPayDate, create, onClose }: {
  newPeriod: string; setNewPeriod: (v: string) => void; newPayDate: string; setNewPayDate: (v: string) => void;
  defaultPayDate: (p: string) => string; create: () => unknown; onClose: () => void;
}) {
  return (
    <Modal
      title="Payroll Run Baru" subtitle="Semua karyawan aktif otomatis dimasukkan" onClose={onClose}
      footer={<><button onClick={onClose} className="fin-btn-secondary">Batal</button><button onClick={create} className="fin-btn-primary">Buat Payroll</button></>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-[11px] font-semibold text-muted-foreground mb-1">Periode (bulan)</span>
          <input type="month" className="input-base" value={newPeriod} onChange={e => { setNewPeriod(e.target.value); setNewPayDate(defaultPayDate(e.target.value)); }} />
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold text-muted-foreground mb-1">Tanggal pembayaran</span>
          <input type="date" className="input-base" value={newPayDate} onChange={e => setNewPayDate(e.target.value)} />
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground mt-4">Payroll Januari–November memakai tarif efektif (TER). Untuk akurasi PPh 21 Desember, buat dan setujui payroll bulan-bulan sebelumnya di tahun yang sama terlebih dulu.</p>
    </Modal>
  );
}
