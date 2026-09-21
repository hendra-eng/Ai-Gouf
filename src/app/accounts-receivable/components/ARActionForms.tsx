'use client';
// Form aksi yang dipakai bersama oleh InvoiceDetailPanel & CustomerDetailPanel:
//  * RecordPaymentForm       -> mencatat pembayaran invoice ke tabel ar_payment
//  * CollectionNotesSection  -> daftar + tambah catatan penagihan (ar_collection_note)
// Validasi dasar dilakukan di sini supaya pesan langsung muncul; aturan yang
// sebenarnya (sisa tagihan, write-off, dst) tetap dijaga backend.
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Invoice } from '@/lib/mockData';
import {
  localTodayISO,
  type AddNoteInput,
  type CollectionNoteView,
  type RecordPaymentInput,
  type RecordPaymentResult,
} from '../lib/arDbBridge';

export const PAYMENT_METHODS = ['Bank Transfer', 'Virtual Account', 'Giro', 'Cash', 'QRIS', 'Lainnya'];
export const NOTE_TYPES = ['General', 'Call', 'Email', 'Visit', 'Reminder', 'Promise to Pay', 'Dispute'];

function rp(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

const inputCls =
  'w-full text-sm border border-border rounded-md px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary/30';

// ─── Catat pembayaran ──────────────────────────────────────────────────────
interface RecordPaymentFormProps {
  /** Invoice yang boleh dipilih (hanya yang masih punya sisa tagihan). */
  invoices: Invoice[];
  /** Kalau diisi, pilihan invoice dikunci ke invoice ini. */
  fixedInvoiceId?: string;
  onRecord: (input: RecordPaymentInput) => Promise<RecordPaymentResult>;
  onDone: () => void;
  onCancel: () => void;
}

export function RecordPaymentForm({ invoices, fixedInvoiceId, onRecord, onDone, onCancel }: RecordPaymentFormProps) {
  const firstId = fixedInvoiceId || invoices[0]?.id || '';
  const [invoiceId, setInvoiceId] = useState(firstId);
  const selected = invoices.find((i) => i.id === invoiceId);
  const [amount, setAmount] = useState(selected ? String(selected.outstanding) : '');
  const [date, setDate] = useState(localTodayISO());
  const [method, setMethod] = useState(PAYMENT_METHODS[0]);
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  if (invoices.length === 0) {
    return (
      <div className="bg-secondary/40 border border-border rounded-lg p-4 text-sm text-muted-foreground">
        Tidak ada invoice dengan sisa tagihan untuk dicatat pembayarannya.
        <button onClick={onCancel} className="ml-2 text-primary hover:underline font-medium">Tutup</button>
      </div>
    );
  }

  const pilihInvoice = (id: string) => {
    setInvoiceId(id);
    const inv = invoices.find((i) => i.id === id);
    if (inv) setAmount(String(inv.outstanding));
  };

  const simpan = async () => {
    if (!selected) { toast.error('Pilih invoice terlebih dahulu'); return; }
    const nominal = Number(amount);
    if (!Number.isFinite(nominal) || nominal <= 0) { toast.error('Nominal pembayaran harus lebih dari 0'); return; }
    if (nominal > selected.outstanding + 0.005) {
      toast.error(`Nominal melebihi sisa tagihan (${rp(selected.outstanding)})`);
      return;
    }
    if (!date) { toast.error('Pilih tanggal pembayaran'); return; }
    if (date > localTodayISO()) { toast.error('Tanggal pembayaran tidak boleh di masa depan'); return; }
    if (date < selected.invoiceDate) { toast.error('Tanggal pembayaran tidak boleh sebelum tanggal invoice'); return; }

    setSaving(true);
    try {
      const res = await onRecord({ invoiceId: selected.id, paymentDate: date, amount: nominal, method, reference: reference.trim() });
      toast.success(
        res.pembayaran.lunas
          ? `Pembayaran ${rp(nominal)} dicatat — ${selected.number} LUNAS`
          : `Pembayaran ${rp(nominal)} dicatat — sisa ${rp(res.pembayaran.sisa_tagihan)}`
      );
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mencatat pembayaran');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 slide-up">
      <h4 className="text-sm font-semibold text-foreground mb-3">Record Payment</h4>
      <div className="space-y-3">
        {!fixedInvoiceId && (
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Invoice</label>
            <select value={invoiceId} onChange={(e) => pilihInvoice(e.target.value)} className={inputCls}>
              {invoices.map((i) => (
                <option key={`pay-inv-${i.id}`} value={i.id}>
                  {i.number} — sisa {rp(i.outstanding)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">
            Payment Amount (IDR){selected ? ` — sisa tagihan ${rp(selected.outstanding)}` : ''}
          </label>
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Payment Date</label>
            <input type="date" value={date} max={localTodayISO()} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
              {PAYMENT_METHODS.map((m) => (
                <option key={`pay-method-${m}`} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">Reference (opsional)</label>
          <input
            type="text"
            maxLength={100}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="mis. TRF-260918-0012"
            className={inputCls}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={simpan}
            disabled={saving}
            className="flex-1 bg-primary text-white text-sm font-medium rounded-md py-2 hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {saving ? 'Menyimpan…' : 'Save Payment'}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 text-sm font-medium text-muted-foreground border border-border rounded-md hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Catatan penagihan ─────────────────────────────────────────────────────
const NOTE_BADGE: Record<string, string> = {
  Dispute: 'bg-danger-bg text-danger-foreground',
  Status: 'bg-warning-bg text-warning-foreground',
  'Promise to Pay': 'bg-success-bg text-success-foreground',
  Call: 'bg-primary/10 text-primary',
  Email: 'bg-primary/10 text-primary',
  Visit: 'bg-primary/10 text-primary',
  Reminder: 'bg-primary/10 text-primary',
};

function formatWaktu(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface CollectionNotesSectionProps {
  notes: CollectionNoteView[];
  customerId: string;
  /** Diisi -> catatan baru terikat ke invoice ini. Kosong -> catatan level customer. */
  invoiceId?: string | null;
  onAdd: (input: AddNoteInput) => Promise<void>;
  /** Fokuskan kolom teks saat pertama tampil (mis. dibuka dari tombol "Add note"). */
  autoFocus?: boolean;
  /** Tampilkan tag nomor invoice di tiap catatan (dipakai di panel customer). */
  showInvoiceTag?: boolean;
}

export function CollectionNotesSection({ notes, customerId, invoiceId, onAdd, autoFocus, showInvoiceTag }: CollectionNotesSectionProps) {
  const [noteType, setNoteType] = useState(NOTE_TYPES[0]);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    textRef.current?.focus();
  }, [autoFocus]);

  const simpan = async () => {
    const isi = content.trim();
    if (!isi) { toast.error('Isi catatan tidak boleh kosong'); return; }
    setSaving(true);
    try {
      await onAdd({ customerId, invoiceId: invoiceId || null, content: isi, noteType });
      setContent('');
      toast.success('Catatan penagihan disimpan');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan catatan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={boxRef} className="space-y-3">
      <div className="space-y-2">
        <div className="flex gap-2">
          <select
            value={noteType}
            onChange={(e) => setNoteType(e.target.value)}
            className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            {NOTE_TYPES.map((t) => (
              <option key={`note-type-${t}`} value={t}>{t}</option>
            ))}
          </select>
          <button
            onClick={simpan}
            disabled={saving || !content.trim()}
            className="ml-auto text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {saving ? 'Menyimpan…' : 'Save Note'}
          </button>
        </div>
        <textarea
          ref={textRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={4000}
          placeholder="Tambah catatan penagihan (hasil telepon, janji bayar, kendala, dst)…"
          rows={3}
          className="w-full text-sm border border-border rounded-md px-3 py-2 bg-secondary/30 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
        />
      </div>

      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">Belum ada catatan penagihan.</p>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="bg-card border border-border rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full ${NOTE_BADGE[n.noteType] || 'bg-secondary text-muted-foreground'}`}>
                    {n.noteType}
                  </span>
                  {showInvoiceTag && n.invoiceNumber && (
                    <span className="text-2xs text-muted-foreground border border-border rounded-full px-1.5 py-0.5">{n.invoiceNumber}</span>
                  )}
                </div>
                <span className="text-2xs text-muted-foreground whitespace-nowrap">{formatWaktu(n.createdAt)}</span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{n.content}</p>
              <p className="text-2xs text-muted-foreground mt-1">oleh {n.createdBy}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
