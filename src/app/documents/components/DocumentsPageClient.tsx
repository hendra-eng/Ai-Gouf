'use client';

import React, { useState, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { FolderOpen, FileText, Receipt, Landmark, FileCheck, ScrollText, ShieldCheck, BarChart3, Folder, Search, Upload, Download, LayoutGrid, List, X, Eye, Trash2, Link2, Tag, CheckCircle, AlertTriangle, Clock, Sparkles, Copy, Move, File, FileSpreadsheet, Image as ImageIcon, FileArchive,  } from 'lucide-react';
import { type FinancialDocument, type DocumentFolder,  } from '@/lib/documentsMockData';
import { useCurrency } from '@/lib/currency';
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

function fileFormatIcon(format: string, size = 16) {
  const cls = 'flex-shrink-0';
  if (format === 'PDF') return <FileText size={size} className={`text-red-500 ${cls}`} />;
  if (format === 'Excel') return <FileSpreadsheet size={size} className={`text-emerald-600 ${cls}`} />;
  if (format === 'Image') return <ImageIcon size={size} className={`text-blue-500 ${cls}`} />;
  if (format === 'CSV') return <FileArchive size={size} className={`text-amber-500 ${cls}`} />;
  return <File size={size} className={`text-muted-foreground ${cls}`} />;
}

function fileFormatBg(format: string): string {
  if (format === 'PDF') return 'bg-red-50';
  if (format === 'Excel') return 'bg-emerald-50';
  if (format === 'Image') return 'bg-blue-50';
  if (format === 'CSV') return 'bg-amber-50';
  return 'bg-muted/60';
}

function StatusBadge({ status }: { status: FinancialDocument['status'] }) {
  const map: Record<string, string> = {
    Processed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Pending Review': 'bg-amber-50 text-amber-700 border-amber-200',
    'Needs Attention': 'bg-red-50 text-red-700 border-red-200',
    Archived: 'bg-gray-50 text-gray-600 border-gray-200',
  };
  const icons: Record<string, React.ReactNode> = {
    Processed: <CheckCircle size={10} />,
    'Pending Review': <Clock size={10} />,
    'Needs Attention': <AlertTriangle size={10} />,
    Archived: <FileArchive size={10} />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${map[status]}`}>
      {icons[status]}
      {status}
    </span>
  );
}

// ─── Document Preview Panel ──────────────────────────────────────────────────

function DocumentPreviewPanel({ doc, onClose }: { doc: FinancialDocument; onClose: () => void }) {
  const { fx } = useCurrency();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const hasFlags = (doc.aiAnalysis?.flags?.length ?? 0) > 0;
  const confidence = doc.aiAnalysis?.confidence ?? 0;

  function handleAction(action: string) {
    setActiveAction(action);
    setTimeout(() => setActiveAction(null), 1500);
    // Backend integration: POST /api/documents/[doc.id]/[action]
  }

  return (
    <div className="flex flex-col h-full">
      {/* Preview Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg ${fileFormatBg(doc.fileFormat)} flex items-center justify-center`}>
            {fileFormatIcon(doc.fileFormat, 15)}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate max-w-[200px]">{doc.name}</p>
            <p className="text-[10px] text-muted-foreground">{doc.type} · {doc.size}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted/60 transition-colors">
          <X size={14} className="text-muted-foreground" />
        </button>
      </div>

      {/* Preview Area */}
      <div className="flex-1 overflow-y-auto">
        {/* Document Visual Placeholder */}
        <div className="bg-muted/20 border-b border-border p-6 flex flex-col items-center justify-center min-h-[200px]">
          <div className={`w-20 h-24 rounded-lg ${fileFormatBg(doc.fileFormat)} border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 mb-3`}>
            {fileFormatIcon(doc.fileFormat, 28)}
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">{doc.fileFormat}</span>
          </div>
          <p className="text-xs text-muted-foreground text-center max-w-[180px] leading-relaxed">
            Preview available after document processing
          </p>
          <button
            onClick={() => handleAction('open')}
            className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Eye size={11} />
            Open Document
          </button>
        </div>

        {/* Metadata */}
        <div className="p-4 space-y-4">
          {/* Status */}
          <div className="flex items-center justify-between">
            <StatusBadge status={doc.status} />
            <span className="text-xs text-muted-foreground">{doc.date}</span>
          </div>

          {/* Details */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Document Details</p>
            {[
              { label: 'Type', value: doc.type },
              { label: 'Company', value: doc.company },
              { label: 'Related Record', value: doc.relatedRecord },
              { label: 'Uploaded By', value: doc.uploadedBy },
              { label: 'Date', value: doc.date },
              { label: 'File Size', value: doc.size },
            ].map(item => (
              <div key={`meta-${item.label}`} className="flex items-start justify-between gap-2">
                <span className="text-xs text-muted-foreground flex-shrink-0">{item.label}</span>
                <span className="text-xs font-medium text-foreground text-right">{item.value}</span>
              </div>
            ))}
          </div>

          {/* Tags */}
          {doc.tags.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tags</p>
              <div className="flex flex-wrap gap-1">
                {doc.tags.map(tag => (
                  <span key={`tag-${doc.id}-${tag}`} className="px-2 py-0.5 bg-muted/60 text-muted-foreground rounded text-[11px]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* AI Analysis */}
          {doc.aiAnalysis && (
            <div className={`rounded-xl border p-4 ${hasFlags ? 'bg-amber-50 border-amber-200' : 'bg-violet-50/60 border-violet-200/60'}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-5 h-5 rounded-md flex items-center justify-center ${hasFlags ? 'bg-amber-500' : 'bg-violet-600'}`}>
                  <Sparkles size={10} className="text-white" />
                </div>
                <p className={`text-xs font-semibold ${hasFlags ? 'text-amber-800' : 'text-violet-800'}`}>
                  AI Document Analysis
                </p>
                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  confidence >= 90 ? 'bg-emerald-100 text-emerald-700' :
                  confidence >= 75 ? 'bg-blue-100 text-blue-700': 'bg-amber-100 text-amber-700'
                }`}>
                  {confidence}% confidence
                </span>
              </div>

              <div className="space-y-1.5">
                {doc.aiAnalysis.vendor && (
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle size={11} className="text-emerald-600 flex-shrink-0" />
                    <span className="text-foreground">Vendor detected: <strong>{doc.aiAnalysis.vendor}</strong></span>
                  </div>
                )}
                {doc.aiAnalysis.amount && (
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle size={11} className="text-emerald-600 flex-shrink-0" />
                    <span className="text-foreground">Amount: <strong className="font-mono">{fx(formatIDR(doc.aiAnalysis.amount))}</strong></span>
                  </div>
                )}
                {doc.aiAnalysis.taxAmount && (
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle size={11} className="text-emerald-600 flex-shrink-0" />
                    <span className="text-foreground">Tax (PPN): <strong className="font-mono">{fx(formatIDR(doc.aiAnalysis.taxAmount))}</strong></span>
                  </div>
                )}
                {doc.aiAnalysis.invoiceNumber && (
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle size={11} className="text-emerald-600 flex-shrink-0" />
                    <span className="text-foreground">Invoice No: <strong>{doc.aiAnalysis.invoiceNumber}</strong></span>
                  </div>
                )}
                {doc.aiAnalysis.flags?.map(flag => (
                  <div key={`flag-${doc.id}-${flag}`} className="flex items-start gap-2 text-xs">
                    <AlertTriangle size={11} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <span className="text-amber-800">{flag}</span>
                  </div>
                ))}
              </div>

              {hasFlags && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleAction('review')}
                    className="flex-1 py-1.5 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors"
                  >
                    {activeAction === 'review' ? 'Reviewing…' : 'Review'}
                  </button>
                  <button
                    onClick={() => handleAction('investigate')}
                    className="flex-1 py-1.5 rounded-md border border-amber-300 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors"
                  >
                    Investigate
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Actions</p>
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
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                    item.action === 'delete'
                      ? 'border-red-200 text-red-600 hover:bg-red-50'
                      : activeAction === item.action
                      ? 'border-primary bg-primary/10 text-primary' :'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground'
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
      className={`hover:bg-muted/20 transition-colors cursor-pointer group ${selected ? 'bg-primary/5' : ''}`}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg ${fileFormatBg(doc.fileFormat)} flex items-center justify-center flex-shrink-0`}>
            {fileFormatIcon(doc.fileFormat, 14)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate max-w-[220px]">{doc.name}</p>
            <p className="text-[11px] text-muted-foreground">{doc.relatedRecord}</p>
          </div>
          {hasFlags && (
            <span title="AI flags detected" className="flex-shrink-0">
  <AlertTriangle size={12} className="text-amber-500" />
</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-sm text-muted-foreground">{doc.type}</span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-sm text-foreground">{doc.date}</span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-sm text-muted-foreground">{doc.uploadedBy}</span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-sm text-muted-foreground">{doc.size}</span>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={doc.status} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={e => { e.stopPropagation(); onClick(); }}
            className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
            title="Preview"
          >
            <Eye size={13} />
          </button>
          <button
            onClick={e => e.stopPropagation()}
            className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            title="Download"
          >
            <Download size={13} />
          </button>
          <button
            onClick={e => e.stopPropagation()}
            className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
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
      className={`bg-card border rounded-xl p-4 cursor-pointer hover:shadow-md transition-all group ${
        selected ? 'border-primary ring-1 ring-primary/20' : 'border-border hover:border-primary/30'
      }`}
    >
      <div className={`w-full h-24 rounded-lg ${fileFormatBg(doc.fileFormat)} flex flex-col items-center justify-center gap-2 mb-3 relative`}>
        {fileFormatIcon(doc.fileFormat, 28)}
        <span className="text-[10px] font-bold uppercase text-muted-foreground">{doc.fileFormat}</span>
        {hasFlags && (
          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
            <AlertTriangle size={10} className="text-white" />
          </div>
        )}
      </div>
      <p className="text-xs font-semibold text-foreground truncate mb-1">{doc.name}</p>
      <p className="text-[11px] text-muted-foreground mb-2">{doc.date} · {doc.size}</p>
      <div className="flex items-center justify-between">
        <StatusBadge status={doc.status} />
        <span className="text-[10px] text-muted-foreground">{doc.uploadedBy.split(' ')[0]}</span>
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

export default function DocumentsPageClient() {
  const { documents, documentFolders, isSampleData, loading: loadingDocs } = useDocumentsData();
  const [activeFolder, setActiveFolder] = useState('folder-all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedDoc, setSelectedDoc] = useState<FinancialDocument | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showUploadZone, setShowUploadZone] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    toast.success(`${files.length} file berhasil diunggah`);
    setShowUploadZone(false);
    // Backend integration: POST /api/documents/upload with FormData
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

  const needsAttentionCount = documents.filter(d => d.status === 'Needs Attention' || (d.aiAnalysis?.flags?.length ?? 0) > 0).length;
  const pendingCount = documents.filter(d => d.status === 'Pending Review').length;
  const activeFolder_ = documentFolders.find(f => f.id === activeFolder);

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <div className="bg-card border-b border-border px-6 py-5">
        <div className="max-w-screen-2xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <FolderOpen size={20} className="text-primary" />
                <h1 className="text-2xl font-bold text-foreground tracking-tight">Documents</h1>
              </div>
              <p className="text-sm text-muted-foreground">Financial document workspace — manage, process, and link documents.</p>
            </div>
            <div className="flex items-center gap-2">
              {needsAttentionCount > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
                  <AlertTriangle size={13} />
                  {needsAttentionCount} need attention
                </div>
              )}
              <button
                onClick={() => setShowUploadZone(!showUploadZone)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Upload size={14} />
                Upload
              </button>
            </div>
          </div>
        </div>
      </div>

      {isSampleData && !loadingDocs && (
        <div className="max-w-screen-2xl mx-auto px-6 pt-4">
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle size={13} className="flex-shrink-0" />
            Showing sample data — select a client with processed documents to see real files.
          </div>
        </div>
      )}

      {/* Upload Zone */}
      {showUploadZone && (
        <div className="max-w-screen-2xl mx-auto px-6 pt-4">
          <div
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFilesSelected(e.dataTransfer.files); }}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              isDragOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/20 hover:border-primary/40'
            }`}
          >
            <Upload size={28} className="text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground mb-1">Drop files here or click to upload</p>
            <p className="text-xs text-muted-foreground mb-4">PDF, Excel, CSV, Images — max 50MB per file</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={e => handleFilesSelected(e.target.files)}
              className="hidden"
            />
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                Browse Files
              </button>
              <button
                onClick={() => setShowUploadZone(false)}
                className="px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
              >
                Cancel
              </button>
            </div>
            {/* Backend integration: POST /api/documents/upload with FormData */}
          </div>
        </div>
      )}

      <div className="max-w-screen-2xl mx-auto px-6 py-6">
        {/* Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Documents', value: documents.length, color: 'text-foreground' },
            { label: 'Processed', value: documents.filter(d => d.status === 'Processed').length, color: 'text-emerald-600' },
            { label: 'Pending Review', value: pendingCount, color: 'text-amber-600' },
            { label: 'Needs Attention', value: needsAttentionCount, color: 'text-red-600' },
          ].map(item => (
            <div key={`ds-${item.label}`} className="bg-card border border-border rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{item.label}</p>
              <p className={`text-2xl font-bold tabular-nums ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </div>

        {/* Three-Pane Layout */}
        <div className="flex gap-5">
          {/* Left: Folder Navigation */}
          <div className="w-52 flex-shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-2">Folders</p>
            <nav className="space-y-0.5">
              {documentFolders.map(folder => (
                <button
                  key={folder.id}
                  onClick={() => setActiveFolder(folder.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                    activeFolder === folder.id
                      ? 'bg-primary/10 text-primary font-medium' :'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={activeFolder === folder.id ? 'text-primary' : 'text-muted-foreground'}>
                      {folderIconMap[folder.icon] ?? <Folder size={15} />}
                    </span>
                    <span className="truncate">{folder.name}</span>
                  </div>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                    activeFolder === folder.id ? 'bg-primary/20 text-primary' : 'bg-muted/60 text-muted-foreground'
                  }`}>
                    {folder.count}
                  </span>
                </button>
              ))}
            </nav>

            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-2">Storage</p>
              <div className="px-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Used</span>
                  <span className="text-xs font-medium text-foreground">284 MB</span>
                </div>
                <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: '28%' }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">of 1 GB total</p>
              </div>
            </div>
          </div>

          {/* Center: Document Library */}
          <div className={`flex-1 min-w-0 flex flex-col ${selectedDoc ? 'max-w-[calc(100%-52px-320px)]' : ''}`}>
            {/* Toolbar */}
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search documents…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="text-sm border border-border rounded-lg px-2.5 py-2 bg-card text-foreground focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="Processed">Processed</option>
                <option value="Pending Review">Pending Review</option>
                <option value="Needs Attention">Needs Attention</option>
                <option value="Archived">Archived</option>
              </select>
              <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-card shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <List size={14} />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-card shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <LayoutGrid size={14} />
                </button>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{filtered.length} docs</span>
            </div>

            {/* Folder Title */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-foreground">{activeFolder_?.name ?? 'All Documents'}</span>
              {activeFolder_ && <span className="text-xs text-muted-foreground">· {activeFolder_.size}</span>}
            </div>

            {/* List View */}
            {viewMode === 'list' && (
              <div className="bg-card border border-border rounded-xl overflow-hidden flex-1">
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <FolderOpen size={28} className="text-muted-foreground mb-3" />
                    <p className="text-sm font-medium text-foreground mb-1">No documents found</p>
                    <p className="text-xs text-muted-foreground mb-3">Upload documents or adjust your filter.</p>
                    <button
                      onClick={() => setShowUploadZone(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors"
                    >
                      <Upload size={11} />
                      Upload Document
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-muted/20">
                          {['Name', 'Type', 'Date', 'Uploaded By', 'Size', 'Status', ''].map((h, i) => (
                            <th key={`dth-${i}`} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {filtered.map(doc => (
                          <DocumentRow
                            key={doc.id}
                            doc={doc}
                            selected={selectedDoc?.id === doc.id}
                            onClick={() => setSelectedDoc(selectedDoc?.id === doc.id ? null : doc)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {filtered.length > 0 && (
                  <div className="px-5 py-3 border-t border-border bg-muted/10 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">{filtered.length} documents</p>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3].map(p => (
                        <button
                          key={`dpage-${p}`}
                          onClick={() => setCurrentPage(p)}
                          className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${p === currentPage ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted/60'}`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Grid View */}
            {viewMode === 'grid' && (
              <div className="flex-1">
                {filtered.length === 0 ? (
                  <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-20 text-center">
                    <FolderOpen size={28} className="text-muted-foreground mb-3" />
                    <p className="text-sm font-medium text-foreground mb-1">No documents found</p>
                    <p className="text-xs text-muted-foreground">Upload documents or adjust your filter.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filtered.map(doc => (
                      <DocumentGridCard
                        key={doc.id}
                        doc={doc}
                        selected={selectedDoc?.id === doc.id}
                        onClick={() => setSelectedDoc(selectedDoc?.id === doc.id ? null : doc)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Preview Panel */}
          {selectedDoc && (
            <div className="w-72 flex-shrink-0 bg-card border border-border rounded-xl overflow-hidden flex flex-col">
              <DocumentPreviewPanel doc={selectedDoc} onClose={() => setSelectedDoc(null)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}