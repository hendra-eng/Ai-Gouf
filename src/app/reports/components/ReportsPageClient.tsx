'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { FileBarChart, TrendingUp, Receipt, ArrowLeftRight, Target, ShieldCheck, Sliders, LayoutGrid, Plus, Calendar, Upload, Search, Download, Eye, Copy, Clock, CheckCircle, AlertCircle, Loader2, FileText, FileSpreadsheet, MoreVertical, X, Printer, RefreshCw, Mail, Pause, Play, BarChart3,  } from 'lucide-react';
import { reports as initialReports, reportCategories, scheduledReports as initialScheduledReports, reportPreviewData, type Report, type ReportCategory, type ScheduledReport,  } from '@/lib/reportsMockData';
import { useCurrency } from '@/lib/currency';
// [BARU] Sambungkan ke client aktif -- lihat lib/useReportsData.ts untuk
// sumber backend & keterbatasan pemetaan (kategori tanpa backend, dst).
import { useReportsData } from '../lib/useReportsData';

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

function downloadCsv(rows: Record<string, string | number>[], filename: string) {
  if (rows.length === 0) return;
  const header = Object.keys(rows[0]);
  const csvRows = rows.map((r) => header.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','));
  const csv = [header.join(','), ...csvRows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function reportToRow(r: Report) {
  return {
    Name: r.name,
    Category: r.category,
    Period: r.period,
    'Last Generated': r.lastGenerated,
    'Created By': r.createdBy,
    Status: r.status,
    Formats: r.formats.join(' / '),
    Size: r.size ?? '',
  };
}

const categoryIconMap: Record<string, React.ReactNode> = {
  'all': <LayoutGrid size={16} />,
  'financial-statements': <FileBarChart size={16} />,
  'management': <TrendingUp size={16} />,
  'tax': <Receipt size={16} />,
  'ar-ap': <ArrowLeftRight size={16} />,
  'budget': <Target size={16} />,
  'audit': <ShieldCheck size={16} />,
  'custom': <Sliders size={16} />,
};

function StatusBadge({ status }: { status: Report['status'] }) {
  const map = {
    ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    generating: 'bg-blue-50 text-blue-700 border-blue-200',
    scheduled: 'bg-violet-50 text-violet-700 border-violet-200',
    error: 'bg-red-50 text-red-700 border-red-200',
  };
  const labels = { ready: 'Ready', generating: 'Generating', scheduled: 'Scheduled', error: 'Error' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${map[status]}`}>
      {status === 'ready' && <CheckCircle size={10} />}
      {status === 'generating' && <Loader2 size={10} className="animate-spin" />}
      {status === 'scheduled' && <Clock size={10} />}
      {status === 'error' && <AlertCircle size={10} />}
      {labels[status]}
    </span>
  );
}

function FormatBadge({ format }: { format: string }) {
  const map: Record<string, string> = {
    PDF: 'bg-red-50 text-red-700 border-red-200',
    Excel: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    CSV: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${map[format] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
      {format}
    </span>
  );
}

function ScheduleStatusBadge({ status }: { status: 'Active' | 'Paused' | 'Error' }) {
  const map = {
    Active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Paused: 'bg-amber-50 text-amber-700 border-amber-200',
    Error: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${map[status]}`}>
      {status === 'Active' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
      {status === 'Paused' && <Pause size={10} />}
      {status === 'Error' && <AlertCircle size={10} />}
      {status}
    </span>
  );
}

// ─── Report Preview Panel ────────────────────────────────────────────────────

function ReportPreviewPanel({ report, onClose }: { report: Report; onClose: () => void }) {
  const { fx } = useCurrency();
  const [period, setPeriod] = useState('Jan – Aug 2026');
  const [basis, setBasis] = useState('Accrual');
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeComparative, setIncludeComparative] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeFormat, setActiveFormat] = useState<string>('PDF');

  const pl = reportPreviewData.profitLoss;
  const isFinancialStatement = report.category === 'financial-statements';

  function handleExport() {
    setExporting(true);
    setTimeout(() => {
      setExporting(false);
      if (activeFormat === 'CSV' && report.category === 'financial-statements' && report.id === 'rpt-001') {
        const rows = [
          ...pl.revenue.map(r => ({ Section: 'Revenue', Item: r.label, Amount: r.amount })),
          { Section: 'Revenue', Item: 'Total Revenue', Amount: pl.totalRevenue },
          { Section: 'COGS', Item: 'Direct Costs', Amount: pl.cogs },
          { Section: 'COGS', Item: 'Gross Profit', Amount: pl.grossProfit },
          ...pl.operatingExpenses.map(e => ({ Section: 'OpEx', Item: e.label, Amount: e.amount })),
          { Section: 'OpEx', Item: 'Total Operating Expenses', Amount: pl.totalOpex },
          { Section: 'Bottom Line', Item: 'EBIT', Amount: pl.ebit },
          { Section: 'Bottom Line', Item: 'Interest Expense', Amount: pl.interestExpense },
          { Section: 'Bottom Line', Item: 'Tax Expense', Amount: pl.taxExpense },
          { Section: 'Bottom Line', Item: 'Net Profit', Amount: pl.netProfit },
        ];
        downloadCsv(rows, `${report.name.replace(/\s+/g, '-')}.csv`);
      } else {
        downloadCsv([reportToRow(report)], `${report.name.replace(/\s+/g, '-')}-summary.csv`);
      }
      toast.success(`Export ${activeFormat} selesai`, { description: `${report.name} · ${period}` });
    }, 1800);
    // Backend integration: POST /api/reports/export { reportId, format, options }
  }

  function handlePrint() {
    toast.info('Menyiapkan cetak', { description: report.name });
    window.print();
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm flex items-start justify-end">
      <div className="h-full w-full max-w-5xl bg-card shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <FileBarChart size={16} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">{report.name}</h2>
              <p className="text-xs text-muted-foreground">{report.period} · {report.createdBy}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Config Panel */}
          <div className="w-60 border-r border-border p-4 overflow-y-auto flex-shrink-0 space-y-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Configuration</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Company</label>
                  <div className="text-xs text-muted-foreground bg-muted/40 rounded-md px-2.5 py-1.5 border border-border">
                    PT Nusantara Teknologi
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Period</label>
                  <select
                    value={period}
                    onChange={e => setPeriod(e.target.value)}
                    className="w-full text-xs border border-border rounded-md px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  >
                    <option>Jan – Aug 2026</option>
                    <option>Jan – Jul 2026</option>
                    <option>Q2 2026 (Apr – Jun)</option>
                    <option>Q1 2026 (Jan – Mar)</option>
                    <option>FY 2025</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Accounting Basis</label>
                  <select
                    value={basis}
                    onChange={e => setBasis(e.target.value)}
                    className="w-full text-xs border border-border rounded-md px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  >
                    <option>Accrual</option>
                    <option>Cash</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Options</p>
              <div className="space-y-2">
                {[
                  { label: 'Include Charts', value: includeCharts, set: setIncludeCharts },
                  { label: 'Include Notes', value: includeNotes, set: setIncludeNotes },
                  { label: 'Comparative Period', value: includeComparative, set: setIncludeComparative },
                ].map(opt => (
                  <label key={`opt-${opt.label}`} className="flex items-center gap-2 cursor-pointer">
                    <div
                      onClick={() => opt.set(!opt.value)}
                      className={`w-8 h-4 rounded-full transition-colors relative ${opt.value ? 'bg-primary' : 'bg-muted'}`}
                    >
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${opt.value ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                    <span className="text-xs text-foreground">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Export Format</p>
              <div className="grid grid-cols-3 gap-1">
                {['PDF', 'Excel', 'CSV'].map(fmt => (
                  <button
                    key={`fmt-${fmt}`}
                    onClick={() => setActiveFormat(fmt)}
                    className={`py-1.5 text-xs font-medium rounded-md border transition-colors ${
                      activeFormat === fmt
                        ? 'bg-primary text-white border-primary' :'bg-card text-muted-foreground border-border hover:border-primary/40'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleExport}
              disabled={exporting}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              {exporting ? 'Generating…' : `Export ${activeFormat}`}
            </button>

            <button
              onClick={handlePrint}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
            >
              <Printer size={12} />
              Print
            </button>
          </div>

          {/* Preview */}
          <div className="flex-1 bg-muted/30 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto bg-card rounded-xl shadow-sm border border-border overflow-hidden">
              {/* Report Header */}
              <div className="bg-primary px-8 py-6 text-white">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium opacity-70 uppercase tracking-wider mb-1">PT Nusantara Teknologi Indonesia</p>
                    <h3 className="text-lg font-bold">{report.name}</h3>
                    <p className="text-xs opacity-70 mt-1">Period: {period} · Basis: {basis}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs opacity-70">Generated</p>
                    <p className="text-sm font-semibold">28 Aug 2026</p>
                    <p className="text-xs opacity-70 mt-1">FinovaAI</p>
                  </div>
                </div>
              </div>

              {/* Report Body */}
              {isFinancialStatement && report.id === 'rpt-001' ? (
                <div className="p-8 space-y-6">
                  {/* Revenue Section */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 pb-2 border-b border-border">Revenue</h4>
                    {pl.revenue.map(r => (
                      <div key={`rev-${r.label}`} className="flex justify-between py-1.5 text-sm">
                        <span className="text-foreground pl-4">{r.label}</span>
                        <span className="font-mono font-medium text-foreground">{fx(formatIDR(r.amount))}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-2 text-sm font-semibold border-t border-border mt-1">
                      <span className="text-foreground">Total Revenue</span>
                      <span className="font-mono text-foreground">{fx(formatIDR(pl.totalRevenue))}</span>
                    </div>
                  </div>

                  {/* COGS */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 pb-2 border-b border-border">Cost of Goods Sold</h4>
                    <div className="flex justify-between py-1.5 text-sm">
                      <span className="text-foreground pl-4">Direct Costs</span>
                      <span className="font-mono font-medium text-foreground">({fx(formatIDR(pl.cogs))})</span>
                    </div>
                    <div className="flex justify-between py-2 text-sm font-semibold border-t border-border mt-1">
                      <span className="text-foreground">Gross Profit</span>
                      <span className="font-mono text-emerald-600">{fx(formatIDR(pl.grossProfit))}</span>
                    </div>
                    <div className="flex justify-between py-1 text-xs text-muted-foreground">
                      <span className="pl-4">Gross Margin</span>
                      <span className="font-mono">44.2%</span>
                    </div>
                  </div>

                  {/* OpEx */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 pb-2 border-b border-border">Operating Expenses</h4>
                    {pl.operatingExpenses.map(e => (
                      <div key={`opex-${e.label}`} className="flex justify-between py-1.5 text-sm">
                        <span className="text-foreground pl-4">{e.label}</span>
                        <span className="font-mono font-medium text-foreground">({fx(formatIDR(e.amount))})</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-2 text-sm font-semibold border-t border-border mt-1">
                      <span className="text-foreground">Total Operating Expenses</span>
                      <span className="font-mono text-foreground">({fx(formatIDR(pl.totalOpex))})</span>
                    </div>
                  </div>

                  {/* Bottom Line */}
                  <div className="bg-muted/40 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground font-medium">EBIT</span>
                      <span className="font-mono font-semibold text-foreground">{fx(formatIDR(pl.ebit))}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground pl-4">Interest Expense</span>
                      <span className="font-mono text-muted-foreground">({fx(formatIDR(Math.abs(pl.interestExpense)))})</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground pl-4">Tax Expense</span>
                      <span className="font-mono text-muted-foreground">({fx(formatIDR(Math.abs(pl.taxExpense)))})</span>
                    </div>
                    <div className="flex justify-between py-2 text-base font-bold border-t border-border mt-1">
                      <span className="text-foreground">Net Profit</span>
                      <span className="font-mono text-emerald-600">{fx(formatIDR(pl.netProfit))}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 flex flex-col items-center justify-center h-64 text-center">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-4">
                    <FileBarChart size={24} />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">{report.name}</p>
                  <p className="text-xs text-muted-foreground max-w-xs">{report.description}</p>
                  <p className="text-xs text-muted-foreground mt-3">Period: {period}</p>
                  <button
                    onClick={handleExport}
                    className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
                  >
                    <RefreshCw size={12} />
                    Generate Preview
                  </button>
                </div>
              )}

              <div className="px-8 py-4 bg-muted/20 border-t border-border flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">PT Nusantara Teknologi Indonesia · NPWP 01.234.567.8-091.000</p>
                <p className="text-[10px] text-muted-foreground">Generated by FinovaAI · Page 1</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Report Card ─────────────────────────────────────────────────────────────

function ReportCard({ report, onPreview }: { report: Report; onPreview: (r: Report) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  function handleQuickDownload() {
    downloadCsv([reportToRow(report)], `${report.name.replace(/\s+/g, '-')}-summary.csv`);
    toast.success('Diunduh', { description: `${report.name} (ringkasan CSV)` });
  }

  function handleExportFormat(format: 'PDF' | 'Excel') {
    setMenuOpen(false);
    toast.success(`Export ${format} dimulai`, { description: `${report.name} akan tersedia untuk diunduh sebentar lagi.` });
  }

  function handleDuplicate() {
    setMenuOpen(false);
    toast.success('Report diduplikasi', { description: `Salinan "${report.name}" ditambahkan ke library.` });
  }

  function handleSchedule() {
    setMenuOpen(false);
    toast.info('Buka penjadwalan', { description: `Atur jadwal otomatis untuk "${report.name}".` });
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:shadow-md hover:border-primary/30 transition-all group relative">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-primary/8 flex items-center justify-center text-primary flex-shrink-0">
            {categoryIconMap[report.category] ?? <FileBarChart size={16} />}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground leading-tight truncate">{report.name}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">{report.period}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={report.status} />
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 rounded hover:bg-muted/60 transition-colors opacity-0 group-hover:opacity-100"
            >
              <MoreVertical size={14} className="text-muted-foreground" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-6 w-40 bg-card border border-border rounded-lg shadow-lg z-20 py-1">
                {[
                  { icon: <Eye size={12} />, label: 'Preview', action: () => { onPreview(report); setMenuOpen(false); } },
                  { icon: <Download size={12} />, label: 'Export PDF', action: () => handleExportFormat('PDF') },
                  { icon: <FileSpreadsheet size={12} />, label: 'Export Excel', action: () => handleExportFormat('Excel') },
                  { icon: <Copy size={12} />, label: 'Duplicate', action: handleDuplicate },
                  { icon: <Calendar size={12} />, label: 'Schedule', action: handleSchedule },
                ].map(item => (
                  <button
                    key={`menu-${item.label}`}
                    onClick={item.action}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-muted-foreground">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{report.description}</p>

      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {report.formats.map(f => <FormatBadge key={`fmt-${report.id}-${f}`} format={f} />)}
        {report.tags?.slice(0, 2).map(tag => (
          <span key={`tag-${report.id}-${tag}`} className="px-1.5 py-0.5 bg-muted/60 text-muted-foreground rounded text-[10px]">
            {tag}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Clock size={11} className="text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">{report.lastGenerated}</span>
          {report.size && <span className="text-[11px] text-muted-foreground">· {report.size}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPreview(report)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/8 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
          >
            <Eye size={11} />
            Preview
          </button>
          <button
            onClick={handleQuickDownload}
            className="p-1.5 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
          >
            <Download size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create Report Modal ─────────────────────────────────────────────────────

function CreateReportModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (data: { name: string; description: string; category: ReportCategory; period: string }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ReportCategory>('custom');
  const [period, setPeriod] = useState('Jan – Aug 2026');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Nama report wajib diisi');
      return;
    }
    onSubmit({ name: name.trim(), description: description.trim() || 'Custom report.', category, period });
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Create Report</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Report Name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Custom Profitability Report"
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Briefly describe what this report shows…"
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as ReportCategory)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {reportCategories.filter(c => c.id !== 'all').map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Period</label>
              <input
                value={period}
                onChange={e => setPeriod(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              Create Report
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add Schedule Modal ───────────────────────────────────────────────────────

function AddScheduleModal({
  reportNames,
  onClose,
  onSubmit,
}: {
  reportNames: string[];
  onClose: () => void;
  onSubmit: (data: { reportName: string; frequency: ScheduledReport['frequency']; recipients: string; format: Report['formats'][number] }) => void;
}) {
  const [reportName, setReportName] = useState(reportNames[0] ?? '');
  const [frequency, setFrequency] = useState<ScheduledReport['frequency']>('Monthly');
  const [recipients, setRecipients] = useState('');
  const [format, setFormat] = useState<Report['formats'][number]>('PDF');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reportName || !recipients.trim()) {
      toast.error('Lengkapi report dan penerima email');
      return;
    }
    onSubmit({ reportName, frequency, recipients, format });
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Add Schedule</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Report</label>
            <select
              value={reportName}
              onChange={e => setReportName(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {reportNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Frequency</label>
              <select
                value={frequency}
                onChange={e => setFrequency(e.target.value as ScheduledReport['frequency'])}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {(['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'] as const).map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Format</label>
              <select
                value={format}
                onChange={e => setFormat(e.target.value as Report['formats'][number])}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {(['PDF', 'Excel', 'CSV'] as const).map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Recipients (comma separated)</label>
            <input
              value={recipients}
              onChange={e => setRecipients(e.target.value)}
              placeholder="cfo@nusantara.co.id, finance@nusantara.co.id"
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              Add Schedule
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ReportsPageClient() {
  const { reports: liveReports, isSampleData, loading: loadingReports } = useReportsData();
  const [reportList, setReportList] = useState<Report[]>(initialReports);
  // [BARU] `reportList` adalah state lokal yang bisa diubah langsung oleh
  // aksi user (delete/duplicate/regenerate) -- karena itu tidak bisa langsung
  // pakai hasil hook sebagai nilai render, tapi disinkronkan lewat efek ini
  // tiap kali data real berubah (mis. client aktif ganti, atau fetch awal
  // selesai). Efek ini SENGAJA menimpa perubahan lokal yang belum disimpan
  // ke backend saat itu terjadi -- sama seperti halaman lain (Liabilities,
  // dst) yang reset ke data server tiap client aktif berganti.
  useEffect(() => {
    setReportList(liveReports);
  }, [liveReports]);
  const [scheduleList, setScheduleList] = useState<ScheduledReport[]>(initialScheduledReports);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewReport, setPreviewReport] = useState<Report | null>(null);
  const [activeTab, setActiveTab] = useState<'library' | 'scheduled'>('library');
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'category'>('date');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    let list = reportList;
    if (activeCategory !== 'all') list = list.filter(r => r.category === activeCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(r => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
    }
    if (sortBy === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'date') list = [...list].sort((a, b) => b.lastGenerated.localeCompare(a.lastGenerated));
    if (sortBy === 'category') list = [...list].sort((a, b) => a.category.localeCompare(b.category));
    return list;
  }, [reportList, activeCategory, searchQuery, sortBy]);

  function handleScheduleReportShortcut() {
    setActiveTab('scheduled');
    setShowScheduleModal(true);
  }

  function handleImportTemplateClick() {
    importInputRef.current?.click();
  }

  function handleImportTemplateFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    toast.success('Template diimpor', { description: `${file.name} berhasil diunggah dan siap digunakan.` });
    e.target.value = '';
  }

  function handleCreateReport(data: { name: string; description: string; category: ReportCategory; period: string }) {
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const newReport: Report = {
      id: `rpt-custom-${Date.now()}`,
      name: data.name,
      description: data.description,
      category: data.category,
      period: data.period,
      lastGenerated: today,
      createdBy: 'You',
      formats: ['PDF'],
      status: 'ready',
      tags: ['Custom'],
    };
    setReportList(prev => [newReport, ...prev]);
    setShowCreateModal(false);
    setActiveCategory('all');
    toast.success('Report dibuat', { description: `${newReport.name} ditambahkan ke library.` });
  }

  function handleAddSchedule(data: { reportName: string; frequency: ScheduledReport['frequency']; recipients: string; format: Report['formats'][number] }) {
    const newSchedule: ScheduledReport = {
      id: `sched-${Date.now()}`,
      reportName: data.reportName,
      frequency: data.frequency,
      recipients: data.recipients.split(',').map(r => r.trim()).filter(Boolean),
      nextRun: 'Pending',
      status: 'Active',
      format: data.format,
    };
    setScheduleList(prev => [newSchedule, ...prev]);
    setShowScheduleModal(false);
    toast.success('Jadwal ditambahkan', { description: `${newSchedule.reportName} — ${newSchedule.frequency}` });
  }

  function toggleScheduleStatus(id: string) {
    setScheduleList(prev => prev.map(s => {
      if (s.id !== id) return s;
      const next = s.status === 'Active' ? 'Paused' : 'Active';
      toast.success(next === 'Paused' ? 'Jadwal dijeda' : 'Jadwal diaktifkan kembali', { description: s.reportName });
      return { ...s, status: next };
    }));
  }

  function sendScheduleNow(schedule: ScheduledReport) {
    toast.success('Laporan dikirim', { description: `${schedule.reportName} dikirim ke ${schedule.recipients.length} penerima.` });
  }

  function deleteSchedule(id: string) {
    setScheduleList(prev => {
      const target = prev.find(s => s.id === id);
      if (target) toast.error('Jadwal dihapus', { description: target.reportName });
      return prev.filter(s => s.id !== id);
    });
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <div className="bg-card border-b border-border px-6 py-5">
        <div className="max-w-screen-2xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 size={20} className="text-primary" />
                <h1 className="text-2xl font-bold text-foreground tracking-tight">Reports</h1>
              </div>
              <p className="text-sm text-muted-foreground">Create, analyze, export, and manage financial reports.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={importInputRef}
                type="file"
                accept=".json,.xlsx,.xls,.docx"
                className="hidden"
                onChange={handleImportTemplateFile}
              />
              <button
                onClick={handleScheduleReportShortcut}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
              >
                <Calendar size={14} />
                Schedule Report
              </button>
              <button
                onClick={handleImportTemplateClick}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
              >
                <Upload size={14} />
                Import Template
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={14} />
                Create Report
              </button>
            </div>
          </div>
        </div>
      </div>

      {isSampleData && !loadingReports && (
        <div className="max-w-screen-2xl mx-auto px-6 pt-4">
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertCircle size={13} className="flex-shrink-0" />
            Showing sample data — select a client with generated reports to see real files.
          </div>
        </div>
      )}

      <div className="max-w-screen-2xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 bg-muted/40 rounded-lg p-1 w-fit">
          {(['library', 'scheduled'] as const).map(tab => (
            <button
              key={`tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'library' ? 'Report Library' : 'Scheduled Reports'}
              {tab === 'scheduled' && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-semibold">
                  {scheduleList.filter(s => s.status === 'Active').length}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'library' && (
          <div className="flex gap-6">
            {/* Category Sidebar */}
            <div className="w-52 flex-shrink-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-2">Categories</p>
              <nav className="space-y-0.5">
                {reportCategories.map(cat => (
                  <button
                    key={`cat-${cat.id}`}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      activeCategory === cat.id
                        ? 'bg-primary/10 text-primary font-medium' :'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={activeCategory === cat.id ? 'text-primary' : 'text-muted-foreground'}>
                        {categoryIconMap[cat.id]}
                      </span>
                      <span>{cat.label}</span>
                    </div>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                      activeCategory === cat.id ? 'bg-primary/20 text-primary' : 'bg-muted/60 text-muted-foreground'
                    }`}>
                      {cat.count}
                    </span>
                  </button>
                ))}
              </nav>
            </div>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
              {/* Toolbar */}
              <div className="flex items-center gap-3 mb-4">
                <div className="relative flex-1 max-w-xs">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search reports…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  />
                </div>
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-xs text-muted-foreground">Sort:</span>
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as typeof sortBy)}
                    className="text-xs border border-border rounded-md px-2 py-1.5 bg-card text-foreground focus:outline-none"
                  >
                    <option value="date">Last Generated</option>
                    <option value="name">Name</option>
                    <option value="category">Category</option>
                  </select>
                  <span className="text-xs text-muted-foreground ml-2">{filtered.length} reports</span>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center mb-3">
                    <FileBarChart size={24} className="text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">No reports found</p>
                  <p className="text-xs text-muted-foreground">Try adjusting your search or category filter.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
                  {filtered.map(r => (
                    <ReportCard key={r.id} report={r} onPreview={setPreviewReport} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'scheduled' && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Scheduled Reports</h2>
              <button
                onClick={() => setShowScheduleModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/8 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
              >
                <Plus size={12} />
                Add Schedule
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {['Report', 'Frequency', 'Recipients', 'Format', 'Next Run', 'Status', ''].map((h, i) => (
                      <th key={`sh-${i}`} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {scheduleList.map(s => (
                    <tr key={s.id} className="hover:bg-muted/20 transition-colors group">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-md bg-primary/8 flex items-center justify-center text-primary flex-shrink-0">
                            <FileText size={13} />
                          </div>
                          <span className="text-sm font-medium text-foreground">{s.reportName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-foreground">{s.frequency}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          {s.recipients.slice(0, 2).map(r => (
                            <span key={`recip-${s.id}-${r}`} className="text-xs text-muted-foreground truncate max-w-[180px]">{r}</span>
                          ))}
                          {s.recipients.length > 2 && (
                            <span className="text-xs text-primary">+{s.recipients.length - 2} more</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <FormatBadge format={s.format} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Calendar size={12} className="text-muted-foreground" />
                          <span className="text-sm text-foreground">{s.nextRun}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ScheduleStatusBadge status={s.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {s.status === 'Active' ? (
                            <button
                              onClick={() => toggleScheduleStatus(s.id)}
                              className="p-1.5 rounded hover:bg-amber-50 text-muted-foreground hover:text-amber-600 transition-colors"
                              title="Pause schedule"
                            >
                              <Pause size={13} />
                            </button>
                          ) : (
                            <button
                              onClick={() => toggleScheduleStatus(s.id)}
                              className="p-1.5 rounded hover:bg-emerald-50 text-muted-foreground hover:text-emerald-600 transition-colors"
                              title="Resume schedule"
                            >
                              <Play size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => sendScheduleNow(s)}
                            className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                            title="Send now"
                          >
                            <Mail size={13} />
                          </button>
                          <button
                            onClick={() => deleteSchedule(s.id)}
                            className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
                            title="Delete schedule"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {scheduleList.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No scheduled reports yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t border-border bg-muted/10 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {scheduleList.filter(s => s.status === 'Active').length} active schedules · {scheduleList.length} total
              </p>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle size={12} className="text-emerald-500" />
                All active schedules running normally
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewReport && (
        <ReportPreviewPanel report={previewReport} onClose={() => setPreviewReport(null)} />
      )}

      {showCreateModal && (
        <CreateReportModal onClose={() => setShowCreateModal(false)} onSubmit={handleCreateReport} />
      )}

      {showScheduleModal && (
        <AddScheduleModal
          reportNames={reportList.map(r => r.name)}
          onClose={() => setShowScheduleModal(false)}
          onSubmit={handleAddSchedule}
        />
      )}
    </div>
  );
}