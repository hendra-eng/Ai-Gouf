'use client';

// Form transaksi Cash & Bank: input manual (kas tunai / kas kecil / bank tanpa
// rekening koran) dan edit transaksi DRAFT (termasuk hasil Reconciliation).
// Baris lawan bisa pelunasan invoice (receipt -> Sales, payment -> Purchase)
// atau akun bebas. Nominal kas = total baris lawan (backend menghitung ulang
// & memvalidasi sisa tagihan). Transaksi dari Bank Feed: arah, tanggal &
// akun bank mengikuti mutasi, total baris wajib sama dengan nominal mutasi.

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { formatIDR } from '../../lib/groupAnalytics';
import { useActiveClient } from '@/lib/activeClient';
import {
  createBcTransaction,
  updateBcTransaction,
  useBcAccounts,
  useBcOpenInvoices,
  CASH_TYPE_LABEL,
  type BcTransaction,
  type Direction,
} from '@/lib/bankCashStore';

const KATEGORI: Record<Direction, string[]> = {
  receipt: ['Customer Payment', 'Other Income', 'Interest Income', 'Capital Injection', 'Loan Received', 'Transfer In', 'Other'],
  payment: ['Vendor Payment', 'Expense', 'Bank Charges', 'Tax Payment', 'Salary', 'Loan Repayment', 'Transfer Out', 'Other'],
};

interface Baris {
  key: number;
  type: 'invoice' | 'account';
  invoiceId: string;
  coaId: string;
  side: 'debit' | 'credit';
  amount: string;
  description: string;
  cari: string;
}

let seq = 0;
const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const sisiLawan = (d: Direction): 'debit' | 'credit' => (d === 'receipt' ? 'credit' : 'debit');
const barisKosong = (d: Direction, type: Baris['type'] = 'invoice'): Baris => ({
  key: ++seq, type, invoiceId: '', coaId: '', side: sisiLawan(d), amount: '', description: '', cari: '',
});

export default function CashBankTransactionModal({ open, onClose, initial, onSaved }: {
  open: boolean;
  onClose: () => void;
  /** Transaksi DRAFT yang diedit; kosong = transaksi baru. */
  initial?: BcTransaction | null;
  onSaved?: (tx: BcTransaction) => void;
}) {
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ? String(activeClientId) : null;
  const { accounts } = useBcAccounts(open ? clientId : null);
  const dariBankFeed = initial?.source === 'bank_feed';

  const [direction, setDirection] = useState<Direction>('receipt');
  const [tanggal, setTanggal] = useState(hariIni());
  const [bankCoaId, setBankCoaId] = useState('');
  const [kategori, setKategori] = useState('');
  const [pihak, setPihak] = useState('');
  const [referensi, setReferensi] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [baris, setBaris] = useState<Baris[]>([barisKosong('receipt')]);
  const [menyimpan, setMenyimpan] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  const invSales = useBcOpenInvoices(open && direction === 'receipt' ? clientId : null, 'sales');
  const invPurchase = useBcOpenInvoices(open && direction === 'payment' ? clientId : null, 'purchase');
  const invoices = direction === 'receipt' ? invSales.invoices : invPurchase.invoices;

  // Isi ulang form tiap dibuka.
  useEffect(() => {
    if (!open) return;
    setPesan(null);
    if (initial) {
      setDirection(initial.direction);
      setTanggal(initial.tx_date);
      setBankCoaId(initial.bank_coa_id);
      setKategori(initial.category || '');
      setPihak(initial.counterparty || '');
      setReferensi(initial.reference || '');
      setKeterangan(initial.description || '');
      setBaris(initial.lines.map((l) => ({
        key: ++seq,
        type: l.line_type === 'account' ? 'account' : 'invoice',
        invoiceId: l.sales_invoice_id || l.purchase_transaction_id || '',
        coaId: l.coa_id || '',
        side: l.debit > 0 ? 'debit' : 'credit',
        amount: String(l.debit || l.credit),
        description: l.description || '',
        cari: '',
      })));
    } else {
      setDirection('receipt');
      setTanggal(hariIni());
      setKategori('');
      setPihak('');
      setReferensi('');
      setKeterangan('');
      setBaris([barisKosong('receipt')]);
    }
  }, [open, initial]);

  const akunKas = useMemo(() => accounts.filter((a) => a.cash_type && a.is_active), [accounts]);
  const akunLawan = useMemo(() => accounts.filter((a) => a.is_active && a.id !== bankCoaId), [accounts, bankCoaId]);

  useEffect(() => {
    if (open && !initial && !akunKas.some((a) => a.id === bankCoaId)) setBankCoaId(akunKas[0]?.id ?? '');
  }, [open, initial, akunKas, bankCoaId]);

  // Sisa invoice yang bisa dipakai di form ini = outstanding + alokasi transaksi ini sendiri (saat edit).
  const sisaInvoice = useMemo(() => {
    const peta = new Map(invoices.map((i) => [i.id, i.outstanding]));
    initial?.lines.forEach((l) => {
      const id = l.sales_invoice_id || l.purchase_transaction_id;
      if (id && peta.has(id)) peta.set(id, (peta.get(id) || 0) + l.amount);
    });
    return peta;
  }, [invoices, initial]);

  const nominal = useMemo(() => baris.reduce((n, b) => {
    const v = Number(b.amount) || 0;
    if (b.type === 'invoice') return n + v;
    return n + (b.side === sisiLawan(direction) ? v : -v);
  }, 0), [baris, direction]);

  const ubah = (key: number, patch: Partial<Baris>) => setBaris((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  const gantiArah = (d: Direction) => {
    if (dariBankFeed) return;
    setDirection(d);
    setKategori('');
    setBaris([barisKosong(d)]);
  };

  const simpan = async () => {
    setPesan(null);
    if (!clientId) return setPesan('Select an active company first.');
    if (!bankCoaId) return setPesan('Select a cash/bank account.');
    if (baris.some((b) => (b.type === 'invoice' ? !b.invoiceId : !b.coaId))) return setPesan('Fill in the invoice / account on every line.');
    if (baris.some((b) => !(Number(b.amount) > 0))) return setPesan('Every line amount must be greater than 0.');
    if (nominal <= 0) return setPesan('The transaction total must be greater than 0 — check the debit/credit side of account lines.');
    if (dariBankFeed && Math.abs(nominal - initial!.amount) > 0.5) {
      return setPesan(`Line total must equal the bank line amount (${formatIDR(initial!.amount)}).`);
    }
    const input = {
      client_id: clientId,
      direction,
      tx_date: tanggal,
      bank_coa_id: bankCoaId,
      category: kategori || null,
      counterparty: pihak || null,
      reference: referensi || null,
      description: keterangan || null,
      lines: baris.map((b) => b.type === 'invoice'
        ? { type: direction === 'receipt' ? 'sales_invoice' as const : 'purchase' as const, invoice_id: b.invoiceId, amount: Number(b.amount), description: b.description || null }
        : { type: 'account' as const, coa_id: b.coaId, side: b.side, amount: Number(b.amount), description: b.description || null }),
    };
    setMenyimpan(true);
    try {
      const { data, message } = initial ? await updateBcTransaction(initial.id, input) : await createBcTransaction(input);
      toast.success(message, { description: `${data.tx_number} · ${formatIDR(data.amount)}` });
      onSaved?.(data);
      onClose();
    } catch (e: any) {
      setPesan(e?.message || 'Failed to save the transaction.');
    } finally {
      setMenyimpan(false);
    }
  };

  if (!open) return null;
  const input = 'w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground disabled:bg-muted/40 disabled:text-muted-foreground';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto scrollbar-thin p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {initial ? `Edit ${initial.tx_number}` : 'New Cash & Bank Transaction'}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {dariBankFeed
                ? 'From a Bank Feed line — direction, date & bank account follow the line.'
                : 'Saved as DRAFT, then Approve → Post in the Journal Preview tab.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><XMarkIcon className="w-4 h-4" /></button>
        </div>

        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 border border-border w-fit">
          {(['receipt', 'payment'] as const).map((d) => (
            <button
              key={d}
              onClick={() => gantiArah(d)}
              disabled={dariBankFeed && d !== direction}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 ${
                direction === d ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {d === 'receipt' ? 'Cash Receipt (money in)' : 'Cash Payment (money out)'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Date</span>
            <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} disabled={dariBankFeed} className={`mt-1 ${input}`} />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Cash / bank account</span>
            <select value={bankCoaId} onChange={(e) => setBankCoaId(e.target.value)} disabled={dariBankFeed} className={`mt-1 ${input}`}>
              {akunKas.length === 0 && <option value="">No cash/bank account in the COA yet</option>}
              {akunKas.map((a) => (
                <option key={a.id} value={a.id}>{a.code} - {a.name} ({a.cash_type ? CASH_TYPE_LABEL[a.cash_type] : ''})</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Category</span>
            <input list={`kategori-${direction}`} value={kategori} onChange={(e) => setKategori(e.target.value)} placeholder="Select or type…" className={`mt-1 ${input}`} />
            <datalist id={`kategori-${direction}`}>
              {KATEGORI[direction].map((k) => <option key={k} value={k} />)}
            </datalist>
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Party (customer / vendor / other)</span>
            <input value={pihak} onChange={(e) => setPihak(e.target.value)} placeholder="Taken from the invoice if left empty" className={`mt-1 ${input}`} />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Reference (voucher / slip no.)</span>
            <input value={referensi} onChange={(e) => setReferensi(e.target.value)} className={`mt-1 ${input}`} />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Description</span>
            <input value={keterangan} onChange={(e) => setKeterangan(e.target.value)} className={`mt-1 ${input}`} />
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground">Counter lines</p>
          {baris.map((b) => {
            const q = b.cari.trim().toLowerCase();
            const pilihanAkun = akunLawan.filter((a) => a.id === b.coaId || !q || `${a.code} ${a.name}`.toLowerCase().includes(q)).slice(0, 80);
            const inv = invoices.find((i) => i.id === b.invoiceId);
            return (
              <div key={b.key} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={b.type}
                    onChange={(e) => ubah(b.key, { type: e.target.value as Baris['type'], invoiceId: '', coaId: '', side: sisiLawan(direction) })}
                    className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
                  >
                    <option value="invoice">{direction === 'receipt' ? 'Sales invoice settlement' : 'Purchase payment'}</option>
                    <option value="account">Other account</option>
                  </select>
                  <div className="flex-1" />
                  {baris.length > 1 && (
                    <button onClick={() => setBaris((prev) => prev.filter((x) => x.key !== b.key))} className="p-1 text-muted-foreground hover:text-rose-600" title="Delete line">
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {b.type === 'invoice' ? (
                  <select
                    value={b.invoiceId}
                    onChange={(e) => {
                      const sisa = sisaInvoice.get(e.target.value) ?? 0;
                      ubah(b.key, { invoiceId: e.target.value, amount: b.amount || (sisa > 0 ? String(sisa) : '') });
                    }}
                    className={input}
                  >
                    <option value="">— select {direction === 'receipt' ? 'Sales invoice' : 'Purchase'} —</option>
                    {invoices
                      .filter((i) => i.id === b.invoiceId || (sisaInvoice.get(i.id) ?? 0) > 0.5)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.no} · {i.party || '—'} · outstanding {formatIDR(sisaInvoice.get(i.id) ?? 0)}
                        </option>
                      ))}
                  </select>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr] gap-2">
                    <input value={b.cari} onChange={(e) => ubah(b.key, { cari: e.target.value })} placeholder="Search account (no. or name)…" className={input} />
                    <select value={b.coaId} onChange={(e) => ubah(b.key, { coaId: e.target.value })} className={input}>
                      <option value="">— select account —</option>
                      {pilihanAkun.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {b.type === 'account' && (
                    <select value={b.side} onChange={(e) => ubah(b.key, { side: e.target.value as Baris['side'] })} className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs">
                      <option value="debit">Debit</option>
                      <option value="credit">Credit</option>
                    </select>
                  )}
                  <input
                    type="number" min="0" step="0.01" value={b.amount}
                    onChange={(e) => ubah(b.key, { amount: e.target.value })}
                    placeholder="Amount"
                    className="w-44 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-mono text-right"
                  />
                  <input value={b.description} onChange={(e) => ubah(b.key, { description: e.target.value })} placeholder="Line description (optional)" className={input} />
                </div>
                {inv && Number(b.amount) > (sisaInvoice.get(inv.id) ?? 0) + 0.5 && (
                  <p className="text-[11px] text-rose-700">Exceeds the outstanding amount {formatIDR(sisaInvoice.get(inv.id) ?? 0)}.</p>
                )}
              </div>
            );
          })}
          <div className="flex gap-3">
            <button onClick={() => setBaris((prev) => [...prev, barisKosong(direction, 'invoice')])} className="flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline">
              <PlusIcon className="w-3 h-3" /> Add invoice
            </button>
            <button onClick={() => setBaris((prev) => [...prev, barisKosong(direction, 'account')])} className="flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline">
              <PlusIcon className="w-3 h-3" /> Add account (e.g. bank charges)
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {direction === 'receipt' ? 'Debit cash/bank account (money in)' : 'Credit cash/bank account (money out)'}
            {dariBankFeed ? ` · must be ${formatIDR(initial!.amount)}` : ''}
          </span>
          <span className={`text-sm font-bold font-mono ${nominal > 0 ? 'text-foreground' : 'text-rose-600'}`}>{formatIDR(nominal)}</span>
        </div>

        {pesan && <p className="text-xs text-rose-700">{pesan}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted">Cancel</button>
          <button
            onClick={simpan}
            disabled={menyimpan}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {menyimpan ? 'Saving…' : initial ? 'Save changes' : 'Save as Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
