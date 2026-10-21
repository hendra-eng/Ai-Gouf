'use client';
// MemoriAIView — kelola ingatan jangka panjang AI.
// Tab "Ingatan": fakta yang dipelajari AI dari percakapan (bisa diedit/dihapus/dinonaktifkan).
// Tab "Percakapan": riwayat percakapan suara & Agent AI yang tercatat.

import { useTabSuara } from '@/lib/tabSuara';
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
// @ts-ignore — api.js adalah file JS
import * as api from '@/app/agent-ai/lib/api';

type Fakta = {
  id: number;
  isi: string;
  kategori: string;
  penting: number;
  klien: string | null;
  sumber: string;
  aktif: boolean;
  jumlah_dipakai: number;
  updated_at: string | null;
};
type Percakapan = { id: number; sumber: string; cuplikan: string; updated_at: string | null };
type Pesan = { role: string; isi: string; waktu: string | null };

const KATEGORI = ['umum', 'klien', 'preferensi', 'aturan', 'orang', 'lainnya'];
const LABEL_SUMBER: Record<string, string> = { otomatis: 'Dipelajari otomatis', perintah: 'Perintah "ingat"', manual: 'Ditulis manual' };
const LABEL_PENTING: Record<number, string> = { 1: 'Biasa', 2: 'Penting', 3: 'Sangat penting' };

const waktu = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1';
const tombolCls =
  'rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1';

export default function MemoriAIView() {
  const [tab, setTab] = useState<'ingatan' | 'percakapan'>('ingatan');
  useTabSuara(['ingatan', 'percakapan'], (k) => setTab(k as 'ingatan' | 'percakapan')); // perintah suara Neo

  // ---- ingatan ----
  const [fakta, setFakta] = useState<Fakta[]>([]);
  const [cari, setCari] = useState('');
  const [status, setStatus] = useState<'aktif' | 'nonaktif' | 'semua'>('aktif');
  const [memuat, setMemuat] = useState(false);
  const [formTambah, setFormTambah] = useState(false);
  const [baru, setBaru] = useState({ isi: '', kategori: 'umum', klien: '', penting: 2 });
  const [editId, setEditId] = useState<number | null>(null);
  const [editIsi, setEditIsi] = useState('');

  // ---- percakapan ----
  const [percakapan, setPercakapan] = useState<Percakapan[]>([]);
  const [terbuka, setTerbuka] = useState<number | null>(null);
  const [pesan, setPesan] = useState<Pesan[]>([]);

  const muatFakta = useCallback(async () => {
    setMemuat(true);
    try {
      const r = await api.daftarFaktaMemori({ q: cari, status });
      setFakta(r.fakta || []);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat ingatan');
    } finally {
      setMemuat(false);
    }
  }, [cari, status]);

  useEffect(() => {
    const t = setTimeout(muatFakta, 250); // tunda sedikit saat mengetik pencarian
    return () => clearTimeout(t);
  }, [muatFakta]);

  useEffect(() => {
    if (tab !== 'percakapan') return;
    api.daftarPercakapanMemori(50)
      .then((r: any) => setPercakapan(r.percakapan || []))
      .catch((e: any) => toast.error(e?.message || 'Gagal memuat percakapan'));
  }, [tab]);

  const bukaPercakapan = async (id: number) => {
    if (terbuka === id) { setTerbuka(null); return; }
    try {
      const r = await api.pesanPercakapanMemori(id);
      setPesan(r.pesan || []);
      setTerbuka(id);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat pesan');
    }
  };

  const hapusPercakapan = async (p: Percakapan) => {
    if (!window.confirm(`Hapus permanen percakapan ini?\n\n"${p.cuplikan || '(kosong)'}"\n\nAI tidak akan mengingatnya lagi.`)) return;
    try {
      await api.hapusPercakapanMemori(p.id);
      toast.success('Percakapan dihapus');
      setPercakapan((daftar) => daftar.filter((x) => x.id !== p.id));
      if (terbuka === p.id) setTerbuka(null);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menghapus percakapan');
    }
  };

  const simpanBaru = async () => {
    try {
      await api.tambahFaktaMemori({
        isi: baru.isi, kategori: baru.kategori, penting: baru.penting, klien: baru.klien || null,
      });
      setBaru({ isi: '', kategori: 'umum', klien: '', penting: 2 });
      setFormTambah(false);
      toast.success('Informasi disimpan ke ingatan AI');
      muatFakta();
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menyimpan');
    }
  };

  const ubah = async (id: number, data: Record<string, any>, pesanSukses?: string) => {
    try {
      await api.ubahFaktaMemori(id, data);
      if (pesanSukses) toast.success(pesanSukses);
      muatFakta();
    } catch (e: any) {
      toast.error(e?.message || 'Gagal mengubah');
    }
  };

  const hapus = async (f: Fakta) => {
    if (!window.confirm(`Hapus permanen ingatan ini?\n\n"${f.isi}"`)) return;
    try {
      await api.hapusFaktaMemori(f.id);
      toast.success('Ingatan dihapus');
      muatFakta();
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menghapus');
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Memori AI</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Informasi penting yang kamu sampaikan lewat suara maupun Agent AI disimpan di sini, lalu dipakai AI untuk
          menjawab pertanyaan berikutnya. Kamu juga bisa bilang langsung: “halo ai, ingat bahwa …” atau “lupakan …”.
          Password, PIN, dan nomor rekening/kartu tidak pernah disimpan.
        </p>
      </div>

      <div className="flex gap-2 border-b border-border">
        {(['ingatan', 'percakapan'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'ingatan' ? 'Ingatan' : 'Percakapan'}
          </button>
        ))}
      </div>

      {tab === 'ingatan' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputCls} max-w-xs`}
              placeholder="Cari ingatan…"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
            />
            <select className={`${inputCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="aktif">Aktif</option>
              <option value="nonaktif">Nonaktif</option>
              <option value="semua">Semua</option>
            </select>
            <button type="button" className={`${tombolCls} ml-auto`} onClick={() => setFormTambah((v) => !v)}>
              {formTambah ? 'Batal' : '+ Tambah informasi'}
            </button>
          </div>

          {formTambah && (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <textarea
                className={`${inputCls} min-h-[72px]`}
                placeholder="Tulis satu informasi, mis. “PT Maju Jaya menutup buku setiap tanggal 25.”"
                value={baru.isi}
                onChange={(e) => setBaru({ ...baru, isi: e.target.value })}
              />
              <div className="flex flex-wrap gap-2">
                <select className={`${inputCls} w-auto`} value={baru.kategori} onChange={(e) => setBaru({ ...baru, kategori: e.target.value })}>
                  {KATEGORI.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <input
                  className={`${inputCls} w-auto min-w-[200px]`}
                  placeholder="Klien terkait (opsional)"
                  value={baru.klien}
                  onChange={(e) => setBaru({ ...baru, klien: e.target.value })}
                />
                <select className={`${inputCls} w-auto`} value={baru.penting} onChange={(e) => setBaru({ ...baru, penting: Number(e.target.value) })}>
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{LABEL_PENTING[n]}</option>)}
                </select>
                <button type="button" className={`${tombolCls} ml-auto`} onClick={simpanBaru} disabled={baru.isi.trim().length < 6}>
                  Simpan
                </button>
              </div>
            </div>
          )}

          {memuat && fakta.length === 0 && <p className="text-sm text-muted-foreground">Memuat…</p>}
          {!memuat && fakta.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Belum ada ingatan. Coba bilang ke AI: “halo ai, ingat bahwa klien kita menutup buku tiap tanggal 25”.
            </div>
          )}

          <ul className="space-y-2">
            {fakta.map((f) => (
              <li key={f.id} className={`rounded-xl border border-border bg-card p-4 ${f.aktif ? '' : 'opacity-60'}`}>
                {editId === f.id ? (
                  <div className="space-y-2">
                    <textarea className={`${inputCls} min-h-[72px]`} value={editIsi} onChange={(e) => setEditIsi(e.target.value)} />
                    <div className="flex gap-2">
                      <button type="button" className={tombolCls} onClick={() => { ubah(f.id, { isi: editIsi }, 'Ingatan diperbarui'); setEditId(null); }}>
                        Simpan
                      </button>
                      <button type="button" className={tombolCls} onClick={() => setEditId(null)}>Batal</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-foreground">{f.isi}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="rounded-full bg-muted px-2 py-0.5">{f.kategori}</span>
                      {f.klien && <span>Klien: {f.klien}</span>}
                      <span>{LABEL_PENTING[f.penting] || 'Penting'}</span>
                      <span>{LABEL_SUMBER[f.sumber] || f.sumber}</span>
                      <span>Dipakai {f.jumlah_dipakai}×</span>
                      <span>{waktu(f.updated_at)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className={tombolCls} onClick={() => { setEditId(f.id); setEditIsi(f.isi); }}>Edit</button>
                      <button
                        type="button"
                        className={tombolCls}
                        onClick={() => ubah(f.id, { aktif: !f.aktif }, f.aktif ? 'Ingatan dinonaktifkan' : 'Ingatan diaktifkan')}
                      >
                        {f.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button type="button" className={`${tombolCls} text-red-500`} onClick={() => hapus(f)}>Hapus</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'percakapan' && (
        <ul className="space-y-2">
          {percakapan.length === 0 && (
            <li className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Belum ada percakapan tercatat.
            </li>
          )}
          {percakapan.map((p) => (
            <li key={p.id} className="rounded-xl border border-border bg-card">
              <div className="flex items-start">
                <button type="button" onClick={() => bukaPercakapan(p.id)} className="flex min-w-0 flex-1 items-start gap-3 p-4 text-left">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{p.sumber === 'suara' ? 'Suara' : 'Agent AI'}</span>
                  <span className="flex-1 truncate text-sm text-foreground">{p.cuplikan || '(kosong)'}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{waktu(p.updated_at)}</span>
                </button>
                <button type="button" className={`${tombolCls} m-3 shrink-0 text-red-500`} onClick={() => hapusPercakapan(p)}>Hapus</button>
              </div>
              {terbuka === p.id && (
                <div className="space-y-2 border-t border-border p-4">
                  {pesan.map((m, i) => (
                    <div key={i} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'ml-auto bg-muted text-foreground' : 'border border-border text-foreground'}`}>
                      {m.isi}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}