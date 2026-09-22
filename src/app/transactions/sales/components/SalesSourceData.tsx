'use client';

import React, { useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { toast } from 'sonner';
import { Upload, Download, Settings, CheckCircle, MoreHorizontal, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import KpiCard from '@/components/shared/KpiCard';
import { downloadBlob } from '../../components/exportTemplates/exportExcelShared';

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

// [BARU] Field sistem yang perlu dipetakan dari kolom file sumber — dipakai
// oleh modal "Mapping Rules" di bawah. `defaultSource` cuma nilai awal yang
// masuk akal (hasil "deteksi otomatis" versi mock), user tetap bisa ganti.
const MAPPING_FIELDS: { key: string; label: string; defaultSource: string }[] = [
  { key: 'tanggal', label: 'Tanggal Transaksi', defaultSource: 'Tanggal' },
  { key: 'invoice', label: 'No. Invoice', defaultSource: 'No. Invoice / Reference' },
  { key: 'customer', label: 'Nama Customer', defaultSource: 'Nama Customer / Buyer' },
  { key: 'dpp', label: 'DPP (Sebelum Pajak)', defaultSource: 'Subtotal / Amount' },
  { key: 'ppn', label: 'PPN (11%)', defaultSource: 'Tax / VAT' },
  { key: 'total', label: 'Total Nilai', defaultSource: 'Grand Total' },
];

const SOURCE_COLUMN_OPTIONS = [
  'Tanggal', 'Tanggal Transaksi', 'No. Invoice / Reference', 'Kode Faktur',
  'Nama Customer / Buyer', 'Nama Pembeli', 'Subtotal / Amount', 'Nilai Sebelum Pajak',
  'Tax / VAT', 'PPN 11%', 'Grand Total', 'Nilai Akhir', 'Tidak Dipetakan',
];

const SOURCE_FILES: any[] = [];

const PREVIEW_ROWS: any[] = [];

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    Berhasil: 'bg-emerald-100 text-emerald-700',
    Diproses: 'bg-blue-100 text-blue-700',
    'Butuh Review': 'bg-amber-100 text-amber-700',
    Gagal: 'bg-red-100 text-red-700',
  };
  return map[s] || 'bg-muted text-muted-foreground';
};

export default function SalesSourceData() {
  const { t } = useLanguage();
  const [sourceFiles, setSourceFiles] = useState(SOURCE_FILES);
  const [selectedFile, setSelectedFile] = useState(sourceFiles[0]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [mappingRules, setMappingRules] = useState<Record<string, string>>(
    () => Object.fromEntries(MAPPING_FIELDS.map((f) => [f.key, f.defaultSource]))
  );

  // ── Upload File: buka file picker asli lewat <input type="file"> yang
  // disembunyikan, lalu setiap file yang dipilih ditambahkan sebagai baris
  // baru di tabel "Daftar File Sumber Penjualan" (status awal 'Diproses'). ──
  const handleUploadClick = () => fileInputRef.current?.click();

  const detectFileType = (name: string): string => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'xlsx' || ext === 'xls') return 'Excel';
    if (ext === 'csv') return 'CSV';
    if (ext === 'pdf') return 'PDF';
    if (ext === 'txt') return 'TXT';
    return ext.toUpperCase() || 'File';
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setIsUploading(true);

    const now = new Date();
    const uploadDate = now.toLocaleString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const period = now.toLocaleString('id-ID', { month: 'short', year: 'numeric' });

    setSourceFiles((prev) => {
      let nextId = Math.max(0, ...prev.map((f) => f.id)) + 1;
      const newEntries = files.map((file) => ({
        id: nextId++,
        uploadDate,
        file: file.name,
        type: detectFileType(file.name),
        customer: '—',
        period,
        rows: 0,
        statusEkstraksi: 'Diproses',
        statusMapping: 'Diproses',
        confidence: 0,
        processedBy: 'Anda',
      }));
      const next = [...newEntries, ...prev];
      setSelectedFile(newEntries[0]);
      return next;
    });

    setIsUploading(false);
    toast.success(t('File berhasil diunggah'), {
      description: `${files.length} ${t('file ditambahkan ke antrian pemrosesan.')}`,
    });
    e.target.value = '';
  };

  // ── Template Excel: bikin file .xlsx kosong dengan kolom yang sistem
  // harapkan (sama seperti kolom di "File Preview" di bawah), berisi header
  // saja supaya user tinggal isi & upload balik. ──
  const handleDownloadTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Template Penjualan');
    sheet.columns = [
      { header: 'Tanggal', key: 'tanggal', width: 14 },
      { header: 'No. Invoice', key: 'invoice', width: 18 },
      { header: 'Nama Customer', key: 'customer', width: 26 },
      { header: 'DPP (IDR)', key: 'dpp', width: 16 },
      { header: 'PPN (IDR)', key: 'ppn', width: 16 },
      { header: 'Total (IDR)', key: 'total', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, 'Template_Data_Penjualan.xlsx');
    toast.success(t('Template Excel diunduh'));
  };

  // ── Export: unduh tabel "Daftar File Sumber Penjualan" yang sedang
  // tampil sebagai .xlsx (bukan data mock statis — ikut state terbaru,
  // termasuk file yang baru saja diupload). ──
  const handleExport = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Source Data');
    sheet.columns = [
      { header: 'Upload Date', key: 'uploadDate', width: 20 },
      { header: 'Source File', key: 'file', width: 28 },
      { header: 'Source Type', key: 'type', width: 12 },
      { header: 'Customer / Entity', key: 'customer', width: 24 },
      { header: 'Period', key: 'period', width: 14 },
      { header: 'Rows Detected', key: 'rows', width: 14 },
      { header: 'Status Ekstraksi', key: 'statusEkstraksi', width: 16 },
      { header: 'Status Mapping', key: 'statusMapping', width: 16 },
      { header: 'Confidence', key: 'confidence', width: 12 },
      { header: 'Processed By', key: 'processedBy', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    sourceFiles.forEach((f) => sheet.addRow(f));
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, `Sales_Source_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(t('Export berhasil'), { description: `${sourceFiles.length} ${t('baris diunduh sebagai Excel.')}` });
  };

  const handleSaveMapping = () => {
    setShowMappingModal(false);
    toast.success(t('Mapping rules disimpan'), {
      description: `${MAPPING_FIELDS.length} ${t('field berhasil dipetakan ke kolom sumber.')}`,
    });
  };

  return (
    <div className="space-y-5">
      <input ref={fileInputRef} type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.txt" className="hidden" onChange={handleFilesSelected} />

      {/* Action Bar — memakai kelas standar btn-secondary/btn-primary yang
          sama dengan tombol "Aksi & Upload Data" di tab Overview, supaya
          konsisten. Tombol biru (primary/CTA) sekarang Mapping Rules,
          Upload File jadi secondary. */}
      <div className="flex flex-wrap items-center gap-2 justify-end">
        <button onClick={handleUploadClick} disabled={isUploading} className="btn-secondary text-xs py-1.5 gap-1.5">
          <Upload size={13} /> {isUploading ? t('Mengunggah...') : t('Upload File')}
        </button>
        <button onClick={handleDownloadTemplate} className="btn-secondary text-xs py-1.5 gap-1.5">
          <Download size={13} /> {t('Template Excel')}
        </button>
        <button onClick={handleExport} className="btn-secondary text-xs py-1.5 gap-1.5">
          <Download size={13} /> {t('Export')}
        </button>
        <button onClick={() => setShowMappingModal(true)} className="btn-primary text-xs py-1.5 gap-1.5">
          <Settings size={13} /> {t('Mapping Rules')}
        </button>
      </div>

      {/* KPI Cards — sekarang pakai KpiCard yang sama dengan tab Overview
          (border tipis, shadow muncul saat hover, ikon Heroicons di kotak
          bulat, dsb), supaya tampilannya benar-benar seragam. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          title={t('Total File Upload')}
          value="0"
          change={t('0% vs periode sebelumnya')}
          icon="ArrowUpTrayIcon"
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
        />
        <KpiCard
          title={t('Menunggu Diproses')}
          value="0"
          change={t('0% vs periode sebelumnya')}
          icon="ClockIcon"
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
        />
        <KpiCard
          title={t('Berhasil Diproses')}
          value="0"
          change={t('0% vs periode sebelumnya')}
          icon="CheckCircleIcon"
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
        />
        <KpiCard
          title={t('Butuh Review')}
          value="0"
          change={t('0% vs periode sebelumnya')}
          icon="ExclamationTriangleIcon"
          iconColor="text-red-600"
          iconBg="bg-red-50"
          alert
        />
      </div>

      {/* File Table */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('Daftar File Sumber Penjualan')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('Kelola file yang diunggah dan pantau status pemrosesan data.')}</p>
          </div>
          <div className="flex items-center gap-2">
            <select className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
              <option>{t('Semua Status')}</option>
              <option>{t('Berhasil')}</option>
              <option>{t('Diproses')}</option>
              <option>{t('Butuh Review')}</option>
              <option>{t('Gagal')}</option>
            </select>
            <select className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
              <option>{t('Semua Tipe File')}</option>
              <option>Excel</option>
              <option>CSV</option>
              <option>PDF</option>
            </select>
            <input type="text" placeholder={t('Cari nama file atau customer...')} className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground w-52" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['#', 'Upload Date', 'Source File', 'Source Type', 'Customer / Entity', 'Period', 'Rows Detected', 'Status Ekstraksi', 'Status Mapping', 'Confidence', 'Processed By', 'Actions'].map(h => (
                  <th key={h} className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground whitespace-nowrap">{t(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sourceFiles.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => setSelectedFile(f)}
                  className={`border-b border-border/50 cursor-pointer transition-colors ${selectedFile?.id === f.id ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                >
                  <td className="py-2.5 px-3 text-xs text-muted-foreground">{f.id}</td>
                  <td className="py-2.5 px-3 text-xs text-foreground whitespace-nowrap">{f.uploadDate}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold ${f.type === 'Excel' ? 'bg-emerald-100 text-emerald-700' : f.type === 'CSV' ? 'bg-blue-100 text-blue-700' : f.type === 'PDF' ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'}`}>{f.type.slice(0, 3)}</div>
                      <span className="text-xs text-foreground font-medium">{f.file}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground">{f.type}</td>
                  <td className="py-2.5 px-3 text-xs text-foreground">{f.customer}</td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">{f.period}</td>
                  <td className="py-2.5 px-3 text-xs text-foreground">{f.rows.toLocaleString('id-ID')}</td>
                  <td className="py-2.5 px-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusBadge(f.statusEkstraksi)}`}>{t(f.statusEkstraksi)}</span></td>
                  <td className="py-2.5 px-3"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusBadge(f.statusMapping)}`}>{t(f.statusMapping)}</span></td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${f.confidence >= 90 ? 'bg-emerald-500' : f.confidence >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${f.confidence}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{f.confidence}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-foreground whitespace-nowrap">{f.processedBy}</td>
                  <td className="py-2.5 px-3">
                    <button className="p-1 hover:bg-muted rounded transition-colors"><MoreHorizontal size={14} className="text-muted-foreground" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('Menampilkan')} 1 - {sourceFiles.length} {t('dari')} {sourceFiles.length} {t('file')}</span>
          <div className="flex items-center gap-1">
            <button className="p-1 hover:bg-muted rounded"><ChevronLeft size={14} /></button>
            {[1,2,3,4].map(p => <button key={p} className={`w-6 h-6 rounded text-xs ${p === 1 ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{p}</button>)}
            <button className="p-1 hover:bg-muted rounded"><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* File Preview */}
        <div className="xl:col-span-1 card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">{t('File Preview')}</h3>
            <button className="text-xs text-primary hover:underline">{t('Lihat Semua Data')}</button>
          </div>
          <div className="flex items-center gap-2 mb-3 p-2 bg-emerald-50 rounded-lg">
            <div className="w-8 h-8 bg-emerald-100 rounded flex items-center justify-center text-[10px] font-bold text-emerald-700">XLS</div>
            <div>
              <p className="text-xs font-semibold text-foreground">{selectedFile?.file ?? t('Belum ada file')}</p>
              <p className="text-[11px] text-muted-foreground">{selectedFile ? `${selectedFile.rows} ${t('baris')} · ${t('Diunggah')} ${selectedFile.uploadDate}` : t('Belum ada data yang diunggah.')}</p>
            </div>
          </div>
          <div className="flex gap-2 mb-3">
            <button className="flex-1 py-1.5 text-xs border-b-2 border-primary text-primary font-medium">{t('Preview Data')}</button>
            <button className="flex-1 py-1.5 text-xs text-muted-foreground hover:text-foreground">{t('Informasi File')}</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['No', 'Tanggal', 'No. Invoice', 'Nama Customer', 'DPP (IDR)', 'PPN (IDR)', 'Total (IDR)'].map(h => (
                    <th key={h} className="text-left py-1.5 px-1.5 text-[10px] font-semibold text-muted-foreground whitespace-nowrap">{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PREVIEW_ROWS.map(r => (
                  <tr key={r.no} className="border-b border-border/50">
                    <td className="py-1.5 px-1.5 text-muted-foreground">{r.no}</td>
                    <td className="py-1.5 px-1.5 whitespace-nowrap">{r.tanggal}</td>
                    <td className="py-1.5 px-1.5 whitespace-nowrap">{r.invoice}</td>
                    <td className="py-1.5 px-1.5 whitespace-nowrap">{r.customer}</td>
                    <td className="py-1.5 px-1.5 text-right">{(r.dpp / 1000).toFixed(0)}</td>
                    <td className="py-1.5 px-1.5 text-right">{(r.ppn / 1000).toFixed(0)}</td>
                    <td className="py-1.5 px-1.5 text-right">{(r.total / 1000).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* AI Extraction Summary */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center">
              <span className="text-[10px] font-bold text-purple-600">AI</span>
            </div>
            <h3 className="text-sm font-semibold text-foreground">{t('AI Extraction Summary')}</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{t('Hasil ekstraksi data menggunakan AI dari file sumber.')}</p>
          <div className="space-y-2 text-xs">
            {[
              ['Total Baris Terdeteksi', '0'],
              ['Baris Valid', '0 (0%)'],
              ['Baris Tidak Valid', '0 (0%)'],
              ['Duplikat Potensial', '0'],
              ['Nilai Transaksi (DPP)', 'Rp 0'],
              ['Nilai PPN', 'Rp 0'],
              ['Nilai Total', 'Rp 0'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-muted-foreground">{t(k)}</span>
                <span className="font-medium text-foreground">{v}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-[11px] text-muted-foreground">ℹ {t('Belum ada file sumber yang diekstraksi')}</p>
          </div>
        </div>

        {/* Data Quality Check */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">{t('Data Quality Check')}</h3>
            <button className="text-xs text-primary hover:underline">{t('Lihat Detail')}</button>
          </div>
          <div className="space-y-2 text-xs">
            {[
              { label: 'Format tanggal valid', val: '0 / 0', ok: true },
              { label: 'No. invoice ditemukan', val: '0 / 0', ok: true },
              { label: 'Nama customer valid', val: '0 / 0', ok: true },
              { label: 'Nilai transaksi valid', val: '0 / 0', ok: true },
              { label: 'PPN sesuai (11%)', val: '0 / 0', ok: true },
              { label: 'Duplikat data', val: '0', ok: true },
              { label: 'Data kosong', val: '0', ok: true },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${item.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <span className="text-muted-foreground">{t(item.label)}</span>
                </div>
                <span className={`font-medium ${item.ok ? 'text-foreground' : 'text-red-600'}`}>{item.val}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs font-semibold text-foreground mb-1.5">{t('Detected Fields')}</p>
            <div className="flex flex-wrap gap-1.5">
              {['No. Invoice', 'Customer', 'Tanggal', 'DPP / Amount', 'PPN', 'Total'].map(f => (
                <span key={f} className="flex items-center gap-1 text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
                  <CheckCircle size={9} /> {t(f)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Mapping Rules — dipicu tombol biru di Action Bar. Petakan
          tiap field sistem ke nama kolom yang terdeteksi di file sumber. */}
      {showMappingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card border border-border rounded-xl shadow-card-lg w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="text-sm font-bold text-foreground">{t('Mapping Rules')}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{t('Petakan kolom file sumber ke field sistem.')}</p>
              </div>
              <button onClick={() => setShowMappingModal(false)} className="p-1 hover:bg-muted rounded transition-colors">
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              {MAPPING_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <span className="text-xs text-foreground w-36 flex-shrink-0">{t(field.label)}</span>
                  <select
                    value={mappingRules[field.key]}
                    onChange={(e) => setMappingRules((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="flex-1 text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
                  >
                    {SOURCE_COLUMN_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{t(opt)}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={() => setShowMappingModal(false)} className="btn-secondary text-xs py-1.5 gap-1.5">
                {t('Batal')}
              </button>
              <button onClick={handleSaveMapping} className="btn-primary text-xs py-1.5 gap-1.5">
                {t('Simpan Mapping')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}