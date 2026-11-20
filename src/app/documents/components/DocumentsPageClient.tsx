'use client';

// [DIUBAH] Tampilan halaman Documents diseragamkan dengan tema "elegant" yang
// dipakai halaman AR / AP / Sales: palet netral (neutral-*), font Inter,
// PageHeading, kartu putih dengan garis atas gelap (Card), KPI bergaya
// KartuGrid, header tabel abu pekat, tombol btnPrimary/btnOutline, dan
// NumberPager. Logika data (useDocumentsData, upload metadata, ubah status,
// filter) TIDAK diubah -- hanya presentasi. Paginasi kini sungguhan (sebelumnya
// tombol 1-2-3 hanya hiasan).

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import {
  FolderOpen, FileText, Receipt, Landmark, FileCheck, ScrollText, ShieldCheck, BarChart3, Folder, Search, Upload,
  Download, LayoutGrid, List, X, Eye, Trash2, Link2, Tag, CheckCircle, AlertTriangle, Clock, Sparkles, Copy, Move,
  File, FileSpreadsheet, Image as ImageIcon, FileArchive, Files,
} from 'lucide-react';
import { type FinancialDocument } from '@/lib/documentsMockData';
import { useCurrency } from '@/lib/currency';
import PageHeading from '@/components/shared/PageHeading';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { btnOutline, btnPrimary, btnSmall, Card, inputCls, NumberPager } from '@/components/arap/arapSalesUi';
// [BARU] Sambungkan ke client aktif -- lihat lib/useDocumentsData.ts untuk
// sumber backend & keterbatasan pemetaan (folder/status/confidence).
import { useDocumentsData } from '../lib/useDocumentsData';

// ─── Helpers ────────────────────────────────────────────────────────────────

// Canonical IDR structure: T (Triliun) > M (Milyar) > Jt (Juta) > Rb (Ribu).
function formatIDR(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `Rp ${(n / 1_000_000_000_000).toFixed(2).replace('.', ',')}T`;
  if (abs >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(2).replace('.', ',')}M`;
  if (abs >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)}Jt`;
  if (abs >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}Rb`;
  return `Rp ${n.toLocaleString('id-ID')}`;
}

const folderIconMap: Record<string, React.ReactNode> = {
  FolderOpen: <FolderOpen size={15} />,
  FileText: <FileText size={15} />,
  Receipt: <Receipt size={15} />,
  Landmark: <Landmark size={15} />,
  FileCheck: <FileCheck size={15} />,
  ScrollText: <ScrollText size={15} />,
  ShieldCheck: <ShieldCheck size={15} />,
  BarChart3: <BarChart3 size={15} />,
  Folder: <Folder size={15} />,
};

// Ikon format file dibuat monokrom (neutral) supaya serasi dengan tema.
function fileFormatIcon(format: string, size = 16) {
  const cls = 'flex-shrink-0 text-neutral-700';
  if (format === 'PDF') return <FileText size={size} className={cls} />;
  if (format === 'Excel') return <FileSpreadsheet size={size} className={cls} />;
  if (format === 'Image') return <ImageIcon size={size} className={cls} />;
  if (format === 'CSV') return <FileArchive size={size} className={cls} />;
  return <File size={size} className={cls} />;
}

const FILE_TILE = 'bg-neutral-100 ring-1 ring-neutral-200';

const STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  Processed: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  'Pending Review': { dot: 'bg-amber-500', text: 'text-amber-700' },
  'Needs Attention': { dot: 'bg-rose-500', text: 'text-rose-600' },
  Archived: { dot: 'bg-neutral-400', text: 'text-neutral-500' },
};

function StatusBadge({ status }: { status: FinancialDocument['status'] }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.Archived;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${s.text}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

// ─── KPI (gaya KartuGrid halaman AR/AP) ─────────────────────────────────────

type Kartu = { label: string; value: string; icon: React.ElementType; note: string; danger?: boolean };

function KpiGrid({ kartu, loading }: { kartu: Kartu[]; loading: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kartu.map(c => {
        const Ikon = c.icon;
        return (
          <div key={c.label} className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
            <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={c.label}>{c.label}</p>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200"><Ikon size={16} /></span>
            </div>
            {loading ? <div className="mt-2 h-6 w-20 animate-pulse rounded bg-neutral-100" /> : (
              <p className={`mt-1 truncate text-lg font-semibold tabular-nums tracking-tight ${c.danger ? 'text-rose-600' : 'text-neutral-900'}`}>{c.value}</p>
            )}
            <div className="mt-1 min-h-4"><span className="text-[11px] text-neutral-500">{c.note}</span></div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Document Preview Panel ──────────────────────────────────────────────────

const DOCUMENT_STATUS_OPTIONS: FinancialDocument['status'][] = ['Processed', 'Pending Review', 'Needs Attention', 'Archived'];

const SECTION_LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-neutral-500';

function DocumentPreviewPanel({
  doc,
  onClose,
  onChangeStatus,
}: {
  doc: FinancialDocument;
  onClose: () => void;
  /** [BARU] Ubah status dokumen (PATCH /api/v1/management/documents/{id}/status)
   * -- opsional supaya panel ini tetap bisa dipakai tanpa mutasi kalau
   * suatu saat dibutuhkan mode read-only. */
  onChangeStatus?: (documentId: string, status: FinancialDocument['status']) => Promise<void>;
}) {
  const { fx } = useCurrency();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const hasFlags = (doc.aiAnalysis?.flags?.length ?? 0) > 0;
  const confidence = doc.aiAnalysis?.confidence ?? 0;

  function handleAction(action: string) {
    setActiveAction(action);
    setTimeout(() => setActiveAction(null), 1500);
    // Backend integration: POST /api/documents/[doc.id]/[action]
  }

  // [BARU] Status dokumen sekarang beneran tersimpan ke Supabase.
  async function handleStatusChange(next: FinancialDocument['status']) {
    if (!onChangeStatus || next === doc.status) return;
    setChangingStatus(true);
    try {
      await onChangeStatus(doc.id, next);
      toast.success('Status dokumen diubah', { description: `${doc.name} → ${next}` });
    } catch (err) {
      toast.error('Gagal mengubah status', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setChangingStatus(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-neutral-300 bg-neutral-50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${FILE_TILE}`}>
            {fileFormatIcon(doc.fileFormat, 15)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900" title={doc.name}>{doc.name}</p>
            <p className="text-[11px] font-medium text-neutral-500">{doc.type} · {doc.size}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-900">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Preview placeholder */}
        <div className="flex min-h-[190px] flex-col items-center justify-center border-b border-neutral-300 bg-neutral-50 p-6">
          <div className="mb-3 flex h-24 w-20 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-400 bg-white">
            {fileFormatIcon(doc.fileFormat, 28)}
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{doc.fileFormat}</span>
          </div>
          <p className="max-w-[180px] text-center text-xs leading-relaxed text-neutral-500">
            Preview available after document processing
          </p>
          <button onClick={() => handleAction('open')} className={`${btnPrimary} mt-3`}>
            <Eye size={12} />
            Open Document
          </button>
        </div>

        <div className="space-y-5 p-4">
          {/* Status */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <StatusBadge status={doc.status} />
              {onChangeStatus && (
                <select
                  value={doc.status}
                  disabled={changingStatus}
                  onChange={e => handleStatusChange(e.target.value as FinancialDocument['status'])}
                  className="rounded-lg border border-neutral-300 bg-white px-1.5 py-1 text-[11px] font-medium text-neutral-900 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-50"
                  title="Ubah status dokumen"
                >
                  {DOCUMENT_STATUS_OPTIONS.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}
            </div>
            <span className="text-xs text-neutral-500">{doc.date}</span>
          </div>

          {/* Details */}
          <div>
            <p className={`${SECTION_LABEL} mb-1`}>Document Details</p>
            <div className="divide-y divide-neutral-200">
              {[
                { label: 'Type', value: doc.type },
                { label: 'Company', value: doc.company },
                { label: 'Related Record', value: doc.relatedRecord },
                { label: 'Uploaded By', value: doc.uploadedBy },
                { label: 'Date', value: doc.date },
                { label: 'File Size', value: doc.size },
              ].map(item => (
                <div key={`meta-${item.label}`} className="flex items-start justify-between gap-3 py-2">
                  <span className="flex-shrink-0 text-xs text-neutral-500">{item.label}</span>
                  <span className="text-right text-xs font-medium text-neutral-900">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tags */}
          {doc.tags.length > 0 && (
            <div>
              <p className={`${SECTION_LABEL} mb-2`}>Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {doc.tags.map(tag => (
                  <span key={`tag-${doc.id}-${tag}`} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 ring-1 ring-neutral-200">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* AI Analysis */}
          {doc.aiAnalysis && (
            <div className={`rounded-lg border p-4 ${hasFlags ? 'border-amber-200 bg-amber-50' : 'border-neutral-300 bg-neutral-50'}`}>
              <div className="mb-3 flex items-center gap-2">
                <div className={`flex h-5 w-5 items-center justify-center rounded-md ${hasFlags ? 'bg-amber-500' : 'bg-neutral-800'}`}>
                  <Sparkles size={10} className="text-white" />
                </div>
                <p className={`text-xs font-semibold ${hasFlags ? 'text-amber-800' : 'text-neutral-900'}`}>
                  AI Document Analysis
                </p>
                <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  confidence >= 90 ? 'bg-emerald-100 text-emerald-700' :
                  confidence >= 75 ? 'bg-neutral-200 text-neutral-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {confidence}% confidence
                </span>
              </div>

              <div className="space-y-1.5">
                {doc.aiAnalysis.vendor && (
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle size={11} className="flex-shrink-0 text-emerald-600" />
                    <span className="text-neutral-800">Vendor detected: <strong>{doc.aiAnalysis.vendor}</strong></span>
                  </div>
                )}
                {doc.aiAnalysis.amount && (
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle size={11} className="flex-shrink-0 text-emerald-600" />
                    <span className="text-neutral-800">Amount: <strong className="tabular-nums">{fx(formatIDR(doc.aiAnalysis.amount))}</strong></span>
                  </div>
                )}
                {doc.aiAnalysis.taxAmount && (
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle size={11} className="flex-shrink-0 text-emerald-600" />
                    <span className="text-neutral-800">Tax (PPN): <strong className="tabular-nums">{fx(formatIDR(doc.aiAnalysis.taxAmount))}</strong></span>
                  </div>
                )}
                {doc.aiAnalysis.invoiceNumber && (
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle size={11} className="flex-shrink-0 text-emerald-600" />
                    <span className="text-neutral-800">Invoice No: <strong>{doc.aiAnalysis.invoiceNumber}</strong></span>
                  </div>
                )}
                {doc.aiAnalysis.flags?.map(flag => (
                  <div key={`flag-${doc.id}-${flag}`} className="flex items-start gap-2 text-xs">
                    <AlertTriangle size={11} className="mt-0.5 flex-shrink-0 text-amber-600" />
                    <span className="text-amber-800">{flag}</span>
                  </div>
                ))}
              </div>

              {hasFlags && (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => handleAction('review')} className={`${btnPrimary} flex-1`}>
                    {activeAction === 'review' ? 'Reviewing…' : 'Review'}
                  </button>
                  <button onClick={() => handleAction('investigate')} className={`${btnOutline} flex-1`}>
                    Investigate
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div>
            <p className={`${SECTION_LABEL} mb-2`}>Actions</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: <Download size={12} />, label: 'Download', action: 'download' },
                { icon: <Copy size={12} />, label: 'Duplicate', action: 'duplicate' },
                { icon: <Move size={12} />, label: 'Move', action: 'move' },
                { icon: <Link2 size={12} />, label: 'Link Record', action: 'link' },
                { icon: <Tag size={12} />, label: 'Add Tag', action: 'tag' },
                { icon: <Trash2 size={12} />, label: 'Delete', action: 'delete' },
              ].map(item => (
                <button
                  key={`action-${item.action}`}
                  onClick={() => handleAction(item.action)}
                  className={`${btnSmall} justify-start py-2 ${
                    item.action === 'delete'
                      ? '!border-rose-200 !text-rose-600 hover:!border-rose-400 hover:!bg-rose-50'
                      : activeAction === item.action ? '!border-neutral-800 !bg-neutral-100' : ''
                  }`}
                >
                  {item.icon}
                  {activeAction === item.action ? 'Done ✓' : item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Document Row ────────────────────────────────────────────────────────────

function DocumentRow({ doc, selected, onClick }: { doc: FinancialDocument; selected: boolean; onClick: () => void }) {
  const hasFlags = (doc.aiAnalysis?.flags?.length ?? 0) > 0;
  return (
    <tr
      onClick={onClick}
      className={`group cursor-pointer transition-colors hover:bg-neutral-200 ${selected ? 'bg-neutral-100' : ''}`}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${FILE_TILE}`}>
            {fileFormatIcon(doc.fileFormat, 14)}
          </div>
          <div className="min-w-0">
            <p className="max-w-[240px] truncate text-xs font-semibold text-neutral-900">{doc.name}</p>
            <p className="text-[11px] text-neutral-500">{doc.relatedRecord}</p>
          </div>
          {hasFlags && (
            <span title="AI flags detected" className="flex-shrink-0">
              <AlertTriangle size={12} className="text-amber-500" />
            </span>
          )}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-neutral-600">{doc.type}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-neutral-900">{doc.date}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-neutral-600">{doc.uploadedBy}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-neutral-600">{doc.size}</td>
      <td className="px-3 py-2.5"><StatusBadge status={doc.status} /></td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={e => { e.stopPropagation(); onClick(); }}
            className="rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-300 hover:text-neutral-900"
            title="Preview"
          >
            <Eye size={13} />
          </button>
          <button
            onClick={e => e.stopPropagation()}
            className="rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-300 hover:text-neutral-900"
            title="Download"
          >
            <Download size={13} />
          </button>
          <button
            onClick={e => e.stopPropagation()}
            className="rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Document Grid Card ──────────────────────────────────────────────────────

function DocumentGridCard({ doc, selected, onClick }: { doc: FinancialDocument; selected: boolean; onClick: () => void }) {
  const hasFlags = (doc.aiAnalysis?.flags?.length ?? 0) > 0;
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-[10px] border bg-white p-3.5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700 ${
        selected ? 'border-neutral-800 ring-1 ring-neutral-800' : 'border-neutral-300'
      }`}
    >
      <div className="relative mb-3 flex h-24 w-full flex-col items-center justify-center gap-2 rounded-lg bg-neutral-100 ring-1 ring-neutral-200">
        {fileFormatIcon(doc.fileFormat, 28)}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{doc.fileFormat}</span>
        {hasFlags && (
          <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500">
            <AlertTriangle size={10} className="text-white" />
          </div>
        )}
      </div>
      <p className="mb-1 truncate text-xs font-semibold text-neutral-900" title={doc.name}>{doc.name}</p>
      <p className="mb-2 text-[11px] text-neutral-500">{doc.date} · {doc.size}</p>
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={doc.status} />
        <span className="truncate text-[10px] text-neutral-500">{doc.uploadedBy.split(' ')[0]}</span>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

const folderTypeMap: Record<string, string> = {
  'folder-all': '',
  'folder-invoices': 'Invoice',
  'folder-receipts': 'Receipt',
  'folder-bank': 'Bank Statement',
  'folder-tax': 'Tax Document',
  'folder-contracts': 'Contract',
  'folder-audit': 'Audit Evidence',
  'folder-reports': 'Financial Report',
  'folder-other': 'Other',
};

function EmptyState({ onUpload }: { onUpload?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-20 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200">
        <FolderOpen size={22} />
      </span>
      <p className="mb-1 text-sm font-semibold text-neutral-900">No documents found</p>
      <p className="mb-4 text-xs text-neutral-500">Upload documents or adjust your filter.</p>
      {onUpload && (
        <button onClick={onUpload} className={btnPrimary}>
          <Upload size={12} />
          Upload Document
        </button>
      )}
    </div>
  );
}

export default function DocumentsPageClient() {
  const {
    documents, documentFolders, isSampleData, loading: loadingDocs,
    activeClientId, uploadDocuments, changeDocumentStatus,
  } = useDocumentsData();
  const [activeFolder, setActiveFolder] = useState('folder-all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedDoc, setSelectedDoc] = useState<FinancialDocument | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showUploadZone, setShowUploadZone] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // [BARU] Sinkronkan panel preview kalau daftar `documents` berubah
  // (mis. setelah status diubah / dokumen baru ditambah) -- tanpa ini,
  // panel akan terus menampilkan snapshot lama walau data di baliknya
  // sudah ter-update di Supabase.
  useEffect(() => {
    if (!selectedDoc) return;
    const updated = documents.find(d => d.id === selectedDoc.id);
    if (updated && updated !== selectedDoc) setSelectedDoc(updated);
  }, [documents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kembali ke halaman pertama setiap filter berubah.
  useEffect(() => { setPage(0); }, [activeFolder, statusFilter, searchQuery, pageSize]);

  // [DIUBAH] Sekarang beneran mencatat metadata dokumen ke Supabase lewat
  // POST /api/v1/management/documents (dbc.tambah_dokumen). File FISIK
  // masih belum diunggah ke storage manapun -- cuma metadatanya (nama,
  // format tebakan dari ekstensi, ukuran) yang tersimpan.
  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!activeClientId) {
      toast.error('Pilih client aktif dulu', { description: 'Dokumen perlu terhubung ke satu client.' });
      return;
    }
    setUploading(true);
    try {
      const category = (folderTypeMap[activeFolder] || undefined) as FinancialDocument['type'] | undefined;
      await uploadDocuments(Array.from(files), category);
      toast.success(`${files.length} dokumen berhasil dicatat`, {
        description: 'Metadata tersimpan -- file fisik belum diunggah ke storage.',
      });
      setShowUploadZone(false);
    } catch (err) {
      toast.error('Gagal mengunggah dokumen', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setUploading(false);
    }
  }

  const filtered = useMemo(() => {
    let list = documents;
    const folderType = folderTypeMap[activeFolder];
    if (folderType) list = list.filter(d => d.type === folderType);
    if (statusFilter !== 'all') list = list.filter(d => d.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) ||
        d.type.toLowerCase().includes(q) ||
        d.relatedRecord.toLowerCase().includes(q) ||
        d.company.toLowerCase().includes(q)
      );
    }
    return list;
  }, [documents, activeFolder, statusFilter, searchQuery]);

  const pageRows = useMemo(() => filtered.slice(page * pageSize, (page + 1) * pageSize), [filtered, page, pageSize]);

  const total = documents.length;
  const processedCount = documents.filter(d => d.status === 'Processed').length;
  const needsAttentionCount = documents.filter(d => d.status === 'Needs Attention' || (d.aiAnalysis?.flags?.length ?? 0) > 0).length;
  const pendingCount = documents.filter(d => d.status === 'Pending Review').length;
  const activeFolder_ = documentFolders.find(f => f.id === activeFolder);
  const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}% of total` : 'No documents yet');

  const kartu: Kartu[] = [
    { label: 'Total Documents', value: String(total), icon: Files, note: `${documentFolders.filter(f => f.id !== 'folder-all').length} folders` },
    { label: 'Processed', value: String(processedCount), icon: CheckCircle, note: pct(processedCount) },
    { label: 'Pending Review', value: String(pendingCount), icon: Clock, note: pct(pendingCount) },
    { label: 'Needs Attention', value: String(needsAttentionCount), icon: AlertTriangle, note: pct(needsAttentionCount), danger: needsAttentionCount > 0 },
  ];

  const toggleDoc = (doc: FinancialDocument) => setSelectedDoc(selectedDoc?.id === doc.id ? null : doc);

  return (
    <div className={`${salesFont.className} min-h-screen bg-background pb-16`}>
      <div className="mx-auto max-w-screen-2xl space-y-5 px-6 py-5 lg:px-8 xl:px-10">
        <PageHeading
          title="Documents"
          description="Financial document workspace — manage, process, and link documents."
          actions={(
            <>
              {needsAttentionCount > 0 && (
                <div className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700">
                  <AlertTriangle size={13} />
                  {needsAttentionCount} need attention
                </div>
              )}
              <button onClick={() => setShowUploadZone(!showUploadZone)} className={btnPrimary}>
                <Upload size={14} />
                Upload
              </button>
            </>
          )}
        />

        {isSampleData && !loadingDocs && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle size={14} className="flex-shrink-0" />
            Showing sample data — select a client with processed documents to see real files.
          </div>
        )}

        {/* Upload Zone */}
        {showUploadZone && (
          <div
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFilesSelected(e.dataTransfer.files); }}
            className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              isDragOver ? 'border-neutral-800 bg-neutral-100' : 'border-neutral-300 bg-neutral-50 hover:border-neutral-500'
            }`}
          >
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-neutral-700 ring-1 ring-neutral-200">
              <Upload size={22} />
            </span>
            <p className="mb-1 text-sm font-semibold text-neutral-900">Drop files here or click to upload</p>
            <p className="mb-4 text-xs text-neutral-500">PDF, Excel, CSV, Images — max 50MB per file</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              disabled={uploading}
              onChange={e => handleFilesSelected(e.target.files)}
              className="hidden"
            />
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className={btnPrimary}>
                {uploading ? 'Menyimpan…' : 'Browse Files'}
              </button>
              <button onClick={() => setShowUploadZone(false)} disabled={uploading} className={btnOutline}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <KpiGrid kartu={kartu} loading={loadingDocs} />

        {/* Grid (bukan flex) supaya lebar kolom pasti: folder 224px, daftar fleksibel, preview 320px. */}
        <div className={`grid grid-cols-1 items-start gap-5 ${selectedDoc ? 'lg:grid-cols-[224px_minmax(0,1fr)_320px]' : 'lg:grid-cols-[224px_minmax(0,1fr)]'}`}>
          {/* Left: Folder Navigation */}
          <div className="min-w-0">
            <Card title="Folders">
              <nav className="space-y-0.5 p-2">
                {documentFolders.map(folder => {
                  const aktif = activeFolder === folder.id;
                  return (
                    <button
                      key={folder.id}
                      onClick={() => setActiveFolder(folder.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
                        aktif ? 'bg-neutral-800 font-semibold text-white' : 'font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={aktif ? 'text-white' : 'text-neutral-500'}>
                          {folderIconMap[folder.icon] ?? <Folder size={15} />}
                        </span>
                        <span className="truncate">{folder.name}</span>
                      </span>
                      <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                        aktif ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200'
                      }`}>
                        {folder.count}
                      </span>
                    </button>
                  );
                })}
              </nav>

              <div className="border-t border-neutral-300 px-4 py-3">
                <p className={`${SECTION_LABEL} mb-2`}>Storage</p>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-neutral-500">Used</span>
                  <span className="text-xs font-semibold text-neutral-900">284 MB</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200">
                  <div className="h-full rounded-full bg-neutral-800" style={{ width: '28%' }} />
                </div>
                <p className="mt-1 text-[10px] text-neutral-500">of 1 GB total</p>
              </div>
            </Card>
          </div>

          {/* Center: Document Library */}
          <div className="min-w-0">
            <Card
              title={activeFolder_?.name ?? 'All Documents'}
              subtitle={`${filtered.length} ${filtered.length === 1 ? 'document' : 'documents'}${activeFolder_ && activeFolder_.size && activeFolder_.size !== '-' ? ` · ${activeFolder_.size}` : ''}`}
              action={(
                <div className="flex items-center gap-0.5 rounded-lg border border-neutral-300 bg-white p-0.5">
                  {([['list', List], ['grid', LayoutGrid]] as const).map(([mode, Ikon]) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      aria-label={`${mode} view`}
                      className={`rounded-md p-1.5 transition-colors ${viewMode === mode ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'}`}
                    >
                      <Ikon size={14} />
                    </button>
                  ))}
                </div>
              )}
            >
              {/* Toolbar */}
              <div className="flex flex-col gap-2 px-5 pb-4 pt-4 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    placeholder="Search documents…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className={`${inputCls} pl-9`}
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className={`${inputCls} sm:w-44`}
                >
                  <option value="all">All Statuses</option>
                  <option value="Processed">Processed</option>
                  <option value="Pending Review">Pending Review</option>
                  <option value="Needs Attention">Needs Attention</option>
                  <option value="Archived">Archived</option>
                </select>
              </div>

              {viewMode === 'list' ? (
                filtered.length === 0 ? (
                  <EmptyState onUpload={() => setShowUploadZone(true)} />
                ) : (
                  <div className="overflow-x-auto px-5">
                    <table className="w-full min-w-[820px] text-xs">
                      <thead>
                        <tr className="bg-neutral-300 text-left text-xs text-black [&>th]:border-y [&>th]:border-neutral-800 [&>th]:px-3 [&>th]:py-2 [&>th]:font-bold">
                          {['Name', 'Type', 'Date', 'Uploaded By', 'Size', 'Status', ''].map((h, i) => (
                            <th key={`dth-${i}`} className="whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-300">
                        {pageRows.map(doc => (
                          <DocumentRow key={doc.id} doc={doc} selected={selectedDoc?.id === doc.id} onClick={() => toggleDoc(doc)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : filtered.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="grid grid-cols-1 gap-3 px-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {pageRows.map(doc => (
                    <DocumentGridCard key={doc.id} doc={doc} selected={selectedDoc?.id === doc.id} onClick={() => toggleDoc(doc)} />
                  ))}
                </div>
              )}

              {filtered.length > 0 && (
                <NumberPager
                  page={page}
                  pageSize={pageSize}
                  total={filtered.length}
                  onPage={setPage}
                  onPageSize={setPageSize}
                  noun="documents"
                  sizes={[10, 25, 50]}
                />
              )}
            </Card>
          </div>

          {/* Right: Preview Panel */}
          {selectedDoc && (
            <div className="min-w-0 lg:sticky lg:top-4">
              <Card className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden">
                <DocumentPreviewPanel doc={selectedDoc} onClose={() => setSelectedDoc(null)} onChangeStatus={changeDocumentStatus} />
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}