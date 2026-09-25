'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DocumentArrowUpIcon, TrashIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import CashBankTabs from '../components/CashBankTabs';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatIDR } from '../../lib/groupAnalytics';
import { useBankFeed, BankFeedMutation } from '../context/BankFeedContext';
import { useActiveClient } from '@/lib/activeClient';
import { ambilCoaClient } from '@/app/agent-ai/lib/api';

// [BARU] Satu akun bank untuk dropdown upload — dibangun dari COA client
// aktif (kategori Kas & Bank = sub_kategori 'Kas', lihat
// db_client.py::_normalisasi_sub_kategori_kas_bank), BUKAN array hardcode
// lagi. `value` dipakai sebagai `bankAccount` (dikirim ke backend & dipakai
// sebagai label di tabel Bank Feed), dibentuk "<no_akun> - <nama_akun>"
// supaya beda akun dengan nama mirip (mis. 2 rekening BCA) tetap unik.
interface AkunBank {
  value: string;
  label: string;
}

function useAkunBankClientAktif() {
  const { activeClientId } = useActiveClient();
  const [akun, setAkun] = useState<AkunBank[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeClientId) {
      setAkun([]);
      return;
    }
    let batal = false;
    setLoading(true);
    ambilCoaClient(activeClientId)
      .then((res: { coa: Array<{ no_akun: string; nama_akun: string; sub_kategori?: string | null }> }) => {
        if (batal) return;
        const daftar = (res?.coa || [])
          .filter((a) => a.sub_kategori === 'Kas')
          .map((a) => ({ value: `${a.no_akun} - ${a.nama_akun}`, label: `${a.no_akun} - ${a.nama_akun}` }));
        setAkun(daftar);
      })
      .catch((err: Error) => {
        if (batal) return;
        console.error('Gagal memuat daftar akun Kas & Bank dari COA:', err);
        setAkun([]);
      })
      .finally(() => {
        if (!batal) setLoading(false);
      });
    return () => {
      batal = true;
    };
  }, [activeClientId]);

  return { akun, loading };
}

function UploadPanel() {
  const { importFile, importing } = useBankFeed();
  const { akun: akunBank, loading: loadingAkun } = useAkunBankClientAktif();
  const inputRef = useRef<HTMLInputElement>(null);
  const [bankAccount, setBankAccount] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Begitu daftar akun COA selesai dimuat, default-kan dropdown ke akun
  // pertama (kalau belum ada pilihan sama sekali).
  useEffect(() => {
    if (!bankAccount && akunBank.length > 0) {
      setBankAccount(akunBank[0].value);
    }
  }, [akunBank, bankAccount]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (!bankAccount) {
      toast.error('Pilih akun bank tujuan dulu sebelum upload.');
      return;
    }
    try {
      const { diimpor, peringatan } = await importFile(file, bankAccount);
      toast.success(`${diimpor} baris mutasi dari ${file.name} berhasil diimpor — cocokkan hasilnya di tab Reconciliation.`);
      if (peringatan.length > 0) {
        toast.warning(peringatan.join(' '));
      }
    } catch (e: any) {
      toast.error(e?.message || 'Gagal mengimpor rekening koran.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="card-elevated-md rounded-xl p-5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">Import Rekening Koran</h2>
          <p className="text-xs text-muted-foreground mt-0.5">PDF atau Excel — hasil ekstraksi akan tampil di tabel bawah untuk dicocokkan</p>
        </div>
        <select
          value={bankAccount}
          onChange={(e) => setBankAccount(e.target.value)}
          disabled={importing || loadingAkun}
          className="px-3 py-2 text-xs bg-muted/40 border border-border rounded-lg focus:outline-none text-foreground disabled:opacity-60"
        >
          {akunBank.length === 0 ? (
            <option value="">
              {loadingAkun ? 'Memuat akun...' : 'Belum ada akun Kas & Bank di COA'}
            </option>
          ) : (
            akunBank.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))
          )}
        </select>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!importing) setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (importing) return;
          handleFile(e.dataTransfer.files?.[0] || null);
        }}
        onClick={() => { if (!importing) inputRef.current?.click(); }}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-10 transition-colors ${
          importing ? 'border-border bg-muted/20 cursor-wait' : 'cursor-pointer'
        } ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'}`}
      >
        {importing ? (
          <>
            <ArrowPathIcon className="w-8 h-8 text-muted-foreground animate-spin" />
            <p className="text-sm text-foreground font-medium">Memproses file — bisa memakan waktu untuk PDF panjang...</p>
          </>
        ) : (
          <>
            <DocumentArrowUpIcon className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-foreground font-medium">Tarik file ke sini atau klik untuk pilih</p>
            <p className="text-xs text-muted-foreground">
              Rekening koran PDF/Excel — untuk akun {bankAccount || '(belum dipilih)'}
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.xlsx,.xls,.csv"
          className="hidden"
          disabled={importing}
          onChange={(e) => handleFile(e.target.files?.[0] || null)}
        />
      </div>
    </div>
  );
}

export default function BankFeedPage() {
  const { mutations, loading, error, refetch, removeMutation, pendingIds } = useBankFeed();
  const [statusFilter, setStatusFilter] = useState<'all' | 'unmatched' | 'matched'>('all');

  const filtered = useMemo(
    () => (statusFilter === 'all' ? mutations : mutations.filter((m) => m.status === statusFilter)),
    [mutations, statusFilter]
  );

  const unmatchedCount = mutations.filter((m) => m.status === 'unmatched').length;

  const handleRemove = async (id: string) => {
    try {
      await removeMutation(id);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menghapus baris mutasi.');
    }
  };

  return (
    <div className="p-6">
      <CashBankTabs />

      <UploadPanel />

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 mb-6">
          <span>{error}</span>
          <button onClick={refetch} className="font-semibold underline hover:no-underline shrink-0">Coba lagi</button>
        </div>
      )}

      <div className="card-elevated-md rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold text-foreground">Mutasi Bank Feed</h2>
          <span className="text-xs text-muted-foreground">
            {unmatchedCount} dari {mutations.length} belum dicocokkan
          </span>
          <div className="ml-auto flex items-center gap-1 bg-muted rounded-lg p-1 border border-border">
            {(['all', 'unmatched', 'matched'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  statusFilter === s ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {s === 'all' ? 'Semua' : s === 'unmatched' ? 'Belum Cocok' : 'Sudah Cocok'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-xs text-muted-foreground py-12 text-center">Memuat mutasi Bank Feed...</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-12 text-center">
            Belum ada mutasi. Import rekening koran di atas untuk memulai.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {['Tanggal', 'Keterangan', 'Akun Bank', 'Masuk', 'Keluar', 'Saldo', 'Status', ''].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-700 uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((m: BankFeedMutation) => {
                  const busy = pendingIds.has(m.id);
                  return (
                    <tr key={m.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{m.date}</td>
                      <td className="px-4 py-3 text-xs text-foreground max-w-[240px] truncate">{m.description}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{m.bankAccount}</td>
                      <td className="px-4 py-3 text-xs font-mono font-semibold text-emerald-700 text-right whitespace-nowrap">
                        {m.credit ? formatIDR(m.credit, true) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono font-semibold text-rose-700 text-right whitespace-nowrap">
                        {m.debit ? formatIDR(m.debit, true) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-foreground text-right whitespace-nowrap">{formatIDR(m.balanceAfter, true)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge
                          label={m.status === 'matched' ? 'Sudah Cocok' : 'Belum Cocok'}
                          variant={m.status === 'matched' ? 'positive' : 'warning'}
                        />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => handleRemove(m.id)}
                          disabled={busy}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-rose-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Hapus baris"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}