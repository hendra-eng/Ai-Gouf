'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Users, Plus, Upload, Download, Search, LayoutGrid, List, ChevronRight, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, X, Building2, ArrowUpRight, ArrowDownRight, Activity, FileText, Receipt, Star, AlertCircle, Eye, ChevronDown, MoreVertical, Pencil, Trash2,  } from 'lucide-react';
import {
  type Client,
  type ClientStatus,
} from '@/lib/clientsMockData';
import { useClientActivity } from '@/app/clients/lib/clientActivityBridge';
import { useClientsList, addClient as addClientToStore, addImportedClients, updateClient as updateClientInStore, deleteClient as deleteClientFromStore } from '@/lib/clientsStore';
import {
  RadialBarChart, RadialBar, ResponsiveContainer,
  LineChart, Line, Tooltip,
} from 'recharts';
import { useCurrency } from '@/lib/currency';

const PAGE_SIZE = 8;

const INDUSTRY_OPTIONS = [
  'Technology',
  'Manufacturing',
  'Distribution',
  'Retail',
  'Food & Beverage',
  'Healthcare',
  'Real Estate',
  'Construction',
  'Logistics',
  'Energy',
  'Agriculture',
  'Financial Services',
  'Education',
  'Hospitality & Tourism',
  'Professional Services',
  'Other',
];

// ─── CSV helpers ─────────────────────────────────────────────────────────────

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

function clientToRow(c: Client) {
  return {
    'Company Name': c.companyName,
    Industry: c.industry,
    Status: c.status,
    'Tax Status': c.taxStatus,
    'Accounting Status': c.accountingStatus,
    Accountant: c.assignedAccountant,
    Revenue: c.financials.revenue,
    'Net Profit': c.financials.netProfit,
    Cash: c.financials.cash,
    AR: c.financials.ar,
    AP: c.financials.ap,
    'Health Score': c.healthScore.overall,
    'Join Date': c.joinDate,
  };
}

function parseClientsCsv(text: string): Client[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const idx = (name: string) => header.findIndex((h) => h.includes(name));
  const nameIdx = idx('company');
  const industryIdx = idx('industry');
  const accountantIdx = idx('accountant');
  const revenueIdx = idx('revenue');

  return lines.slice(1).map((line, i) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const companyName = (nameIdx >= 0 && cols[nameIdx]) || `Imported Client ${i + 1}`;
    const revenue = revenueIdx >= 0 ? Number(cols[revenueIdx]) || 0 : 0;
    const now = new Date();
    const joinDate = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return {
      id: `client-imported-${Date.now()}-${i}`,
      companyName,
      industry: (industryIdx >= 0 && cols[industryIdx]) || 'General',
      status: 'Stable',
      taxStatus: 'Pending',
      accountingStatus: 'Pending Review',
      assignedAccountant: (accountantIdx >= 0 && cols[accountantIdx]) || 'Unassigned',
      financials: {
        revenue,
        netProfit: 0,
        cash: 0,
        ar: 0,
        ap: 0,
        grossMargin: 0,
        revenueGrowth: 0,
        trendData: [0, 0, 0, 0, 0, 0, 0, 0],
      },
      healthScore: { overall: 50, liquidity: 50, profitability: 50, cashFlow: 50, solvency: 50, compliance: 50 },
      joinDate,
      lastActivity: joinDate,
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      npwp: '',
      address: '',
      aiInsight: 'New client imported — insufficient data for AI assessment yet.',
    } as Client;
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Canonical IDR structure: T (Triliun) > M (Milyar) > Jt (Juta) > Rb (Ribu).
function formatIDR(n: number, compact = true): string {
  if (compact) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000_000) return `Rp ${(n / 1_000_000_000_000).toFixed(2).replace('.', ',')}T`;
    if (abs >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(2).replace('.', ',')}M`;
    if (abs >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)}Jt`;
    if (abs >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}Rb`;
  }
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function StatusBadge({ status }: { status: ClientStatus }) {
  const map: Record<ClientStatus, string> = {
    Healthy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Stable: 'bg-blue-50 text-blue-700 border-blue-200',
    'Attention Required': 'bg-amber-50 text-amber-700 border-amber-200',
    Critical: 'bg-red-50 text-red-700 border-red-200',
  };
  const icons: Record<ClientStatus, React.ReactNode> = {
    Healthy: <CheckCircle size={10} />,
    Stable: <Activity size={10} />,
    'Attention Required': <AlertTriangle size={10} />,
    Critical: <AlertCircle size={10} />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${map[status]}`}>
      {icons[status]}
      {status}
    </span>
  );
}

function TaxBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Compliant: 'bg-emerald-50 text-emerald-700',
    Pending: 'bg-amber-50 text-amber-700',
    Overdue: 'bg-red-50 text-red-700',
    'Under Review': 'bg-blue-50 text-blue-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? 'bg-gray-50 text-gray-600'}`}>
      {status}
    </span>
  );
}

function AccountingBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    'Up to Date': 'text-emerald-600',
    'Pending Review': 'text-amber-600',
    'Needs Attention': 'text-orange-600',
    Behind: 'text-red-600',
  };
  return <span className={`text-xs font-medium ${map[status] ?? 'text-muted-foreground'}`}>{status}</span>;
}

function HealthScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? '#059669' : score >= 60 ? '#1B4FD8' : score >= 40 ? '#D97706' : '#DC2626';
  const data = [{ value: score, fill: color }, { value: 100 - score, fill: '#F1F5F9' }];
  return (
    <div className="relative w-16 h-16">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="60%" outerRadius="90%" data={data} startAngle={90} endAngle={-270} barSize={6}>
          <RadialBar dataKey="value" cornerRadius={3} background={false} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold tabular-nums" style={{ color }}>{score}</span>
      </div>
    </div>
  );
}

function MiniSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width={60} height={28}>
      <LineChart data={chartData}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={positive ? '#059669' : '#DC2626'}
          strokeWidth={1.5}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Client Detail Drawer ────────────────────────────────────────────────────

function ClientDetailDrawer({ client, onClose }: { client: Client; onClose: () => void }) {
  const { fx } = useCurrency();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('overview');

  function handleFullAIAnalysis() {
    toast.info('Membuka analisis AI lengkap', { description: `Menganalisis data keuangan ${client.companyName}…` });
    router.push(`/ai-financial-analyst?client=${client.id}`);
  }

  function handleGenerateReport() {
    downloadCsv([clientToRow(client)], `client-report-${client.id}.csv`);
    toast.success('Laporan dibuat', { description: `Ringkasan keuangan ${client.companyName} berhasil diunduh.` });
  }

  function handleViewFullProfile() {
    setActiveTab('overview');
    toast.info('Menampilkan profil lengkap', { description: client.companyName });
  }

  function handleGoToReports() {
    router.push(`/reports?client=${client.id}`);
  }

  function handleGoToTax() {
    router.push(`/tax-compliance?client=${client.id}`);
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'financial', label: 'Financial' },
    { id: 'health', label: 'Health Score' },
    { id: 'activity', label: 'Activity' },
    { id: 'ai', label: 'AI Insights' },
  ];

  const healthItems = [
    { label: 'Liquidity', score: client.healthScore.liquidity },
    { label: 'Profitability', score: client.healthScore.profitability },
    { label: 'Cash Flow', score: client.healthScore.cashFlow },
    { label: 'Solvency', score: client.healthScore.solvency },
    { label: 'Compliance', score: client.healthScore.compliance },
  ];

  const { activity, loading: activityLoading } = useClientActivity(client.id);

  function scoreColor(s: number) {
    if (s >= 80) return 'bg-emerald-500';
    if (s >= 60) return 'bg-blue-500';
    if (s >= 40) return 'bg-amber-500';
    return 'bg-red-500';
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm flex items-start justify-end">
      <div className="h-full w-full max-w-2xl bg-card shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Building2 size={22} className="text-primary" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">{client.companyName}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">{client.industry}</span>
                  <span className="text-muted-foreground">·</span>
                  <StatusBadge status={client.status} />
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors">
              <X size={16} className="text-muted-foreground" />
            </button>
          </div>

          <div className="flex items-center gap-4 mt-4">
            <HealthScoreRing score={client.healthScore.overall} />
            <div className="grid grid-cols-3 gap-4 flex-1">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Revenue</p>
                <p className="text-sm font-bold font-mono text-foreground">{fx(formatIDR(client.financials.revenue))}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Net Profit</p>
                <p className={`text-sm font-bold font-mono ${client.financials.netProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {fx(formatIDR(client.financials.netProfit))}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Cash</p>
                <p className="text-sm font-bold font-mono text-foreground">{fx(formatIDR(client.financials.cash))}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-6 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={`dt-${t.id}`}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === t.id
                  ? 'border-primary text-primary' :'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted/30 rounded-xl p-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Contact</p>
                  <p className="text-sm font-semibold text-foreground">{client.contactName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{client.contactEmail}</p>
                  <p className="text-xs text-muted-foreground">{client.contactPhone}</p>
                </div>
                <div className="bg-muted/30 rounded-xl p-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Assigned Accountant</p>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-semibold">
                      {client.assignedAccountant.split(' ').map(n => n[0]).join('')}
                    </div>
                    <span className="text-sm font-medium text-foreground">{client.assignedAccountant}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Last activity: {client.lastActivity}</p>
                </div>
              </div>
              <div className="bg-muted/30 rounded-xl p-4 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Company Details</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">NPWP:</span> <span className="font-mono text-foreground ml-1">{client.npwp}</span></div>
                  <div><span className="text-muted-foreground">Client Since:</span> <span className="text-foreground ml-1">{client.joinDate}</span></div>
                  <div className="col-span-2"><span className="text-muted-foreground">Address:</span> <span className="text-foreground ml-1">{client.address}</span></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/30 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Tax Status</p>
                  <TaxBadge status={client.taxStatus} />
                </div>
                <div className="bg-muted/30 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Accounting Status</p>
                  <AccountingBadge status={client.accountingStatus} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'financial' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Revenue', value: client.financials.revenue, color: 'text-foreground' },
                  { label: 'Net Profit', value: client.financials.netProfit, color: client.financials.netProfit < 0 ? 'text-red-600' : 'text-emerald-600' },
                  { label: 'Cash', value: client.financials.cash, color: 'text-foreground' },
                  { label: 'Accounts Receivable', value: client.financials.ar, color: 'text-blue-600' },
                  { label: 'Accounts Payable', value: client.financials.ap, color: 'text-foreground' },
                  { label: 'Gross Margin', value: null, display: `${client.financials.grossMargin.toFixed(1)}%`, color: 'text-foreground' },
                ].map(item => (
                  <div key={`fin-${item.label}`} className="bg-muted/30 rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{item.label}</p>
                    <p className={`text-base font-bold font-mono ${item.color}`}>
                      {item.display ?? fx(formatIDR(item.value!))}
                    </p>
                  </div>
                ))}
              </div>
              <div className="bg-muted/30 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-foreground">Revenue Trend</p>
                  <div className={`flex items-center gap-1 text-xs font-medium ${client.financials.revenueGrowth >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {client.financials.revenueGrowth >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {client.financials.revenueGrowth >= 0 ? '+' : ''}{client.financials.revenueGrowth.toFixed(1)}% YoY
                  </div>
                </div>
                <div className="h-20">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={client.financials.trendData.map((v, i) => ({ i, v }))}>
                      <Line
                        type="monotone"
                        dataKey="v"
                        stroke={client.financials.revenueGrowth >= 0 ? '#059669' : '#DC2626'}
                        strokeWidth={2}
                        dot={false}
                      />
                      <Tooltip
                        formatter={(v: number) => [fx(`Rp ${v.toFixed(2).replace('.', ',')}M`), 'Revenue']}
                        contentStyle={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 8 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'health' && (
            <div className="space-y-6">
              <div className="flex items-center gap-4 bg-muted/30 rounded-xl p-4">
                <HealthScoreRing score={client.healthScore.overall} />
                <div>
                  <p className="text-lg font-bold text-foreground">
                    {client.healthScore.overall} / 100
                  </p>
                  <p className="text-sm text-muted-foreground">Overall Health Score</p>
                  <StatusBadge status={client.status} />
                </div>
              </div>
              <div className="space-y-3">
                {healthItems.map(item => (
                  <div key={`hi-${item.label}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-foreground">{item.label}</span>
                      <span className="text-xs font-bold font-mono text-foreground">{item.score}</span>
                    </div>
                    <div className="h-2 bg-muted/60 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${scoreColor(item.score)}`}
                        style={{ width: `${item.score}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="space-y-3">
              {activityLoading ? (
                <div className="text-center py-10">
                  <p className="text-sm text-muted-foreground">Memuat aktivitas…</p>
                </div>
              ) : activity.length === 0 ? (
                <div className="text-center py-10">
                  <Activity size={24} className="text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No recent activity for this client.</p>
                </div>
              ) : (
                activity.map(item => (
                  <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Activity size={12} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">{item.action}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{item.user} · {item.date} {item.time}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-200/60 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center">
                    <Star size={12} className="text-white" />
                  </div>
                  <p className="text-sm font-semibold text-violet-800">AI Financial Assessment</p>
                </div>
                <p className="text-sm text-violet-900 leading-relaxed">{client.aiInsight}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Recommended Actions</p>
                {client.status === 'Critical' && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <AlertCircle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-red-700">Immediate intervention required</p>
                      <p className="text-xs text-red-600 mt-0.5">Schedule urgent financial review meeting with client.</p>
                    </div>
                  </div>
                )}
                {client.status === 'Attention Required' && (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-amber-700">Review recommended within 7 days</p>
                      <p className="text-xs text-amber-600 mt-0.5">Address outstanding compliance and cash flow issues.</p>
                    </div>
                  </div>
                )}
                {(client.status === 'Healthy' || client.status === 'Stable') && (
                  <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <CheckCircle size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-emerald-700">Client in good standing</p>
                      <p className="text-xs text-emerald-600 mt-0.5">Continue regular monthly review cycle.</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleFullAIAnalysis}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition-colors"
                >
                  <Star size={12} />
                  Full AI Analysis
                </button>
                <button
                  onClick={handleGenerateReport}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
                >
                  <FileText size={12} />
                  Generate Report
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-border flex items-center gap-2">
          <button
            onClick={handleViewFullProfile}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            <Eye size={12} />
            View Full Profile
          </button>
          <button
            onClick={handleGoToReports}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
          >
            <FileText size={12} />
            Reports
          </button>
          <button
            onClick={handleGoToTax}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
          >
            <Receipt size={12} />
            Tax
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Portfolio Card ──────────────────────────────────────────────────────────

function ClientPortfolioCard({
  client,
  onClick,
  onEdit,
  onDelete,
}: {
  client: Client;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { fx } = useCurrency();
  const isPositive = client.financials.revenueGrowth >= 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <div
      onClick={onClick}
      className="relative bg-card border border-border rounded-xl p-5 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 size={18} className="text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground leading-tight truncate max-w-[160px]">{client.companyName}</h3>
            <p className="text-xs text-muted-foreground">{client.industry}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <HealthScoreRing score={client.healthScore.overall} />
          <div className="relative" ref={menuRef}>
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
              className="p-1 rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
              aria-label="Menu client"
            >
              <MoreVertical size={16} />
            </button>
            {menuOpen && (
              <div
                onClick={e => e.stopPropagation()}
                className="absolute right-0 top-full mt-1 w-36 bg-card border border-border rounded-lg shadow-lg py-1 z-10"
              >
                <button
                  onClick={() => { setMenuOpen(false); onEdit(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted/40 transition-colors"
                >
                  <Pencil size={13} />
                  Edit
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Revenue</p>
          <p className="text-sm font-bold font-mono text-foreground">{fx(formatIDR(client.financials.revenue))}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Net Profit</p>
          <p className={`text-sm font-bold font-mono ${client.financials.netProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {fx(formatIDR(client.financials.netProfit))}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">AR</p>
          <p className="text-sm font-medium font-mono text-foreground">{fx(formatIDR(client.financials.ar))}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">AP</p>
          <p className="text-sm font-medium font-mono text-foreground">{fx(formatIDR(client.financials.ap))}</p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <StatusBadge status={client.status} />
        <div className="flex items-center gap-2">
          <MiniSparkline data={client.financials.trendData} positive={isPositive} />
          <div className={`flex items-center gap-0.5 text-xs font-medium ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
            {isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(client.financials.revenueGrowth).toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <TaxBadge status={client.taxStatus} />
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-muted/60 flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
            {client.assignedAccountant.split(' ').map(n => n[0]).join('')}
          </div>
          <span className="text-xs text-muted-foreground">{client.assignedAccountant.split(' ')[0]}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Add Client Modal ────────────────────────────────────────────────────────

function AddClientModal({
  onClose,
  onSubmit,
  initialClient,
}: {
  onClose: () => void;
  onSubmit: (c: Omit<Client, 'id' | 'financials' | 'healthScore' | 'joinDate' | 'lastActivity' | 'aiInsight'>) => Promise<void> | void;
  /** Kalau diisi, modal jadi mode Edit (prefill + judul/tombol berubah,
   *  companyName dikunci karena backend tidak expose endpoint ganti nama). */
  initialClient?: Client;
}) {
  const isEditMode = !!initialClient;
  const [companyName, setCompanyName] = useState(initialClient?.companyName ?? '');
  const [industry, setIndustry] = useState(initialClient?.industry ?? '');
  const [contactName, setContactName] = useState(initialClient?.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(initialClient?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(initialClient?.contactPhone ?? '');
  const [npwp, setNpwp] = useState(initialClient?.npwp ?? '');
  const [address, setAddress] = useState(initialClient?.address ?? '');
  const [assignedAccountant, setAssignedAccountant] = useState(initialClient?.assignedAccountant ?? '');
  const [status, setStatus] = useState<ClientStatus>(initialClient?.status ?? 'Stable');
  // [FIX] Sebelumnya tombol submit tidak pernah di-nonaktifkan selama
  // request ke backend masih berjalan -- klik ganda (double-click) yang
  // cepat akan memicu handleSubmit 2x sebelum request pertama selesai,
  // hasilnya client (atau perubahan) tersimpan dobel. isSubmitting
  // mengunci form begitu submit pertama mulai.
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = companyName.trim() && industry.trim() && assignedAccountant.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return; // [FIX] cegah submit ganda
    if (!isValid) {
      toast.error('Lengkapi data wajib', { description: 'Nama perusahaan, industri, dan akuntan wajib diisi.' });
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        companyName: companyName.trim(),
        industry: industry.trim(),
        status,
        taxStatus: 'Pending',
        accountingStatus: 'Pending Review',
        assignedAccountant: assignedAccountant.trim(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        npwp: npwp.trim(),
        address: address.trim(),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-card rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">{isEditMode ? 'Edit Client' : 'Add New Client'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1">Company Name *</label>
              <input
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="PT Contoh Sejahtera"
                disabled={isEditMode}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-muted/40 disabled:text-muted-foreground"
              />
              {isEditMode && (
                <p className="text-[10px] text-muted-foreground mt-1">Nama perusahaan tidak bisa diubah.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Industry *</label>
              <select
                value={industry}
                onChange={e => setIndustry(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
              >
                <option value="" disabled>Select industry</option>
                {INDUSTRY_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as ClientStatus)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {(['Healthy', 'Stable', 'Attention Required', 'Critical'] as ClientStatus[]).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1">Assigned Accountant *</label>
              <input
                value={assignedAccountant}
                onChange={e => setAssignedAccountant(e.target.value)}
                placeholder="Sari Dewi"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Contact Name</label>
              <input
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Contact Phone</label>
              <input
                value={contactPhone}
                onChange={e => setContactPhone(e.target.value)}
                placeholder="+62 21 5555 0000"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1">Contact Email</label>
              <input
                type="email"
                value={contactEmail}
                onChange={e => setContactEmail(e.target.value)}
                placeholder="contact@company.co.id"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">NPWP</label>
              <input
                value={npwp}
                onChange={e => setNpwp(e.target.value)}
                placeholder="00.000.000.0-000.000"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Address</label>
              <input
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {isSubmitting ? 'Menyimpan...' : (isEditMode ? 'Save Changes' : 'Add Client')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ClientsPageClient() {
  const { fx } = useCurrency();
  // Single shared source of truth: built-in mock clients + anything the user
  // has added, kept in sync with the header "Switch Company" dropdown.
  const { clients: clientList, loading: clientsLoading, error: clientsError } = useClientsList();
  const [viewMode, setViewMode] = useState<'table' | 'portfolio'>('portfolio');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [sortCol, setSortCol] = useState<string>('revenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    let list = clientList;
    if (statusFilter !== 'all') list = list.filter(c => c.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c =>
        c.companyName.toLowerCase().includes(q) ||
        c.industry.toLowerCase().includes(q) ||
        c.assignedAccountant.toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      if (sortCol === 'revenue') { va = a.financials.revenue; vb = b.financials.revenue; }
      else if (sortCol === 'profit') { va = a.financials.netProfit; vb = b.financials.netProfit; }
      else if (sortCol === 'health') { va = a.healthScore.overall; vb = b.healthScore.overall; }
      else if (sortCol === 'name') { va = a.companyName; vb = b.companyName; }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return list;
  }, [clientList, searchQuery, statusFilter, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  React.useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, sortCol, sortDir]);

  const portfolioSummary = useMemo(() => ({
    total: clientList.length,
    healthy: clientList.filter(c => c.status === 'Healthy').length,
    stable: clientList.filter(c => c.status === 'Stable').length,
    attention: clientList.filter(c => c.status === 'Attention Required').length,
    critical: clientList.filter(c => c.status === 'Critical').length,
    totalRevenue: clientList.reduce((s, c) => s + c.financials.revenue, 0),
    avgHealth: clientList.length ? Math.round(clientList.reduce((s, c) => s + c.healthScore.overall, 0) / clientList.length) : 0,
  }), [clientList]);

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  function handleExport() {
    downloadCsv(filtered.map(clientToRow), `clients-export-${Date.now()}.csv`);
    toast.success('Export berhasil', { description: `${filtered.length} klien diunduh sebagai CSV.` });
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = parseClientsCsv(String(reader.result));
        if (imported.length === 0) {
          toast.error('Import gagal', { description: 'File CSV tidak berisi data klien yang valid.' });
          return;
        }
        addImportedClients(imported)
          .then(() => {
            toast.success('Import berhasil', { description: `${imported.length} klien ditambahkan dari CSV.` });
          })
          .catch((err) => {
            toast.error('Import gagal', { description: err instanceof Error ? err.message : 'Terjadi kesalahan.' });
          });
      } catch {
        toast.error('Import gagal', { description: 'Format file tidak dapat dibaca.' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleAddClient(newClient: Omit<Client, 'id' | 'financials' | 'healthScore' | 'joinDate' | 'lastActivity' | 'aiInsight'>) {
    try {
      const client = await addClientToStore(newClient);
      setShowAddModal(false);
      toast.success('Klien ditambahkan', { description: `${client.companyName} berhasil ditambahkan ke portfolio.` });
    } catch (err) {
      toast.error('Gagal menambah klien', { description: err instanceof Error ? err.message : 'Terjadi kesalahan.' });
    }
  }

  async function handleUpdateClient(updates: Omit<Client, 'id' | 'financials' | 'healthScore' | 'joinDate' | 'lastActivity' | 'aiInsight'>) {
    if (!editingClient) return;
    try {
      await updateClientInStore(editingClient.id, updates);
      setEditingClient(null);
      toast.success('Klien diperbarui', { description: `${updates.companyName} berhasil diperbarui.` });
    } catch (err) {
      toast.error('Gagal memperbarui klien', { description: err instanceof Error ? err.message : 'Terjadi kesalahan.' });
    }
  }

  async function handleDeleteClient(client: Client) {
    const konfirmasi = window.confirm(`Hapus client "${client.companyName}"? Tindakan ini tidak bisa dibatalkan.`);
    if (!konfirmasi) return;
    try {
      await deleteClientFromStore(client.id);
      if (selectedClient?.id === client.id) setSelectedClient(null);
      toast.success('Klien dihapus', { description: `${client.companyName} berhasil dihapus dari portfolio.` });
    } catch (err) {
      toast.error('Gagal menghapus klien', { description: err instanceof Error ? err.message : 'Terjadi kesalahan.' });
    }
  }

  const statusOptions = ['all', 'Healthy', 'Stable', 'Attention Required', 'Critical'];

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <div className="bg-card border-b border-border px-6 py-5">
        <div className="max-w-screen-2xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Users size={20} className="text-primary" />
                <h1 className="text-2xl font-bold text-foreground tracking-tight">Clients</h1>
              </div>
              <p className="text-sm text-muted-foreground">Monitor client financial health, accounting status, and service activity.</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleImportFile}
              />
              <button
                onClick={handleImportClick}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
              >
                <Upload size={14} />
                Import
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
              >
                <Download size={14} />
                Export
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={14} />
                Add Client
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        {clientsLoading && (
          <div className="text-xs text-muted-foreground px-1">Memuat data klien...</div>
        )}
        {clientsError && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Gagal memuat data klien dari server: {clientsError}
          </div>
        )}
        {/* Portfolio Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Total Clients', value: portfolioSummary.total, color: 'text-foreground', bg: 'bg-card' },
            { label: 'Healthy', value: portfolioSummary.healthy, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            { label: 'Stable', value: portfolioSummary.stable, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Needs Attention', value: portfolioSummary.attention, color: 'text-amber-600', bg: 'bg-amber-50' },
            { label: 'Critical', value: portfolioSummary.critical, color: 'text-red-600', bg: 'bg-red-50' },
            { label: 'Avg Health Score', value: portfolioSummary.avgHealth, color: 'text-violet-600', bg: 'bg-violet-50' },
          ].map(item => (
            <div key={`ps-${item.label}`} className={`${item.bg} border border-border rounded-xl p-4`}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{item.label}</p>
              <p className={`text-2xl font-bold tabular-nums ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </div>

        {/* Health Distribution Visual */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Portfolio Health Distribution</h2>
            <p className="text-xs text-muted-foreground">{clientList.length} clients · {fx(formatIDR(portfolioSummary.totalRevenue))} total revenue</p>
          </div>
          <div className="flex items-center gap-2 h-8">
            {[
              { status: 'Healthy', count: portfolioSummary.healthy, color: 'bg-emerald-500' },
              { status: 'Stable', count: portfolioSummary.stable, color: 'bg-blue-500' },
              { status: 'Attention Required', count: portfolioSummary.attention, color: 'bg-amber-500' },
              { status: 'Critical', count: portfolioSummary.critical, color: 'bg-red-500' },
            ].map(item => (
              <div
                key={`dist-${item.status}`}
                onClick={() => setStatusFilter(item.status)}
                className={`${item.color} h-full rounded-lg flex items-center justify-center transition-all hover:opacity-90 cursor-pointer`}
                style={{ width: `${(item.count / clientList.length) * 100}%` }}
                title={`${item.status}: ${item.count} — click to filter`}
              >
                <span className="text-white text-xs font-semibold">{item.count}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            {[
              { label: 'Healthy', color: 'bg-emerald-500' },
              { label: 'Stable', color: 'bg-blue-500' },
              { label: 'Attention Required', color: 'bg-amber-500' },
              { label: 'Critical', color: 'bg-red-500' },
            ].map(item => (
              <div key={`legend-${item.label}`} className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${item.color}`} />
                <span className="text-xs text-muted-foreground">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search clients…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-border rounded-lg px-3 py-2 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {statusOptions.map(s => (
                <option key={`sf-${s}`} value={s}>{s === 'all' ? 'All Statuses' : s}</option>
              ))}
            </select>

            <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
              <button
                onClick={() => setViewMode('portfolio')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'portfolio' ? 'bg-card shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                title="Portfolio view"
              >
                <LayoutGrid size={15} />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-card shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                title="Table view"
              >
                <List size={15} />
              </button>
            </div>

            <span className="text-xs text-muted-foreground">{filtered.length} clients</span>
          </div>
        </div>

        {/* Portfolio View */}
        {viewMode === 'portfolio' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
            {filtered.map(client => (
              <ClientPortfolioCard
                key={client.id}
                client={client}
                onClick={() => setSelectedClient(client)}
                onEdit={() => setEditingClient(client)}
                onDelete={() => handleDeleteClient(client)}
              />
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-20 text-center">
                <div className="w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center mb-3">
                  <Users size={24} className="text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">No clients found</p>
                <p className="text-xs text-muted-foreground">Try adjusting your search or filter.</p>
              </div>
            )}
          </div>
        )}

        {/* Table View */}
        {viewMode === 'table' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {[
                      { label: 'Company', col: 'name' },
                      { label: 'Industry', col: null },
                      { label: 'Status', col: null },
                      { label: 'Revenue', col: 'revenue' },
                      { label: 'Net Profit', col: 'profit' },
                      { label: 'Cash', col: null },
                      { label: 'AR', col: null },
                      { label: 'AP', col: null },
                      { label: 'Tax Status', col: null },
                      { label: 'Health', col: 'health' },
                      { label: 'Accountant', col: null },
                      { label: '', col: null },
                    ].map((h, i) => (
                      <th
                        key={`th-${i}`}
                        onClick={() => h.col && toggleSort(h.col)}
                        className={`px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap ${h.col ? 'cursor-pointer hover:text-foreground' : ''}`}
                      >
                        <div className="flex items-center gap-1">
                          {h.label}
                          {h.col && sortCol === h.col && (
                            <ChevronDown size={11} className={`transition-transform ${sortDir === 'asc' ? 'rotate-180' : ''}`} />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginated.map(client => (
                    <tr
                      key={client.id}
                      className="hover:bg-muted/20 transition-colors group cursor-pointer"
                      onClick={() => setSelectedClient(client)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Building2 size={13} className="text-primary" />
                          </div>
                          <span className="text-sm font-medium text-foreground whitespace-nowrap max-w-[160px] truncate">
                            {client.companyName}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-muted-foreground whitespace-nowrap">{client.industry}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={client.status} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono font-medium text-foreground whitespace-nowrap">
                          {fx(formatIDR(client.financials.revenue))}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-sm font-mono font-medium whitespace-nowrap ${client.financials.netProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {fx(formatIDR(client.financials.netProfit))}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono text-foreground whitespace-nowrap">
                          {fx(formatIDR(client.financials.cash))}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono text-foreground whitespace-nowrap">
                          {fx(formatIDR(client.financials.ar))}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono text-foreground whitespace-nowrap">
                          {fx(formatIDR(client.financials.ap))}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <TaxBadge status={client.taxStatus} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-2 bg-muted/60 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                client.healthScore.overall >= 80 ? 'bg-emerald-500' :
                                client.healthScore.overall >= 60 ? 'bg-blue-500' :
                                client.healthScore.overall >= 40 ? 'bg-amber-500' : 'bg-red-500'
                              }`}
                              style={{ width: `${client.healthScore.overall}%` }}
                            />
                          </div>
                          <span className="text-sm font-mono font-semibold text-foreground">
                            {client.healthScore.overall}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-muted/60 flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
                            {client.assignedAccountant.split(' ').map(n => n[0]).join('')}
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {client.assignedAccountant.split(' ')[0]}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={e => { e.stopPropagation(); setSelectedClient(client); }}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t border-border bg-muted/10 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} clients
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="w-7 h-7 rounded-md text-xs font-medium transition-colors text-muted-foreground hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ‹
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button
                    key={`page-${p}`}
                    onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${p === page ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted/60'}`}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="w-7 h-7 rounded-md text-xs font-medium transition-colors text-muted-foreground hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ›
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedClient && (
        <ClientDetailDrawer client={selectedClient} onClose={() => setSelectedClient(null)} />
      )}

      {showAddModal && (
        <AddClientModal onClose={() => setShowAddModal(false)} onSubmit={handleAddClient} />
      )}

      {editingClient && (
        <AddClientModal
          initialClient={editingClient}
          onClose={() => setEditingClient(null)}
          onSubmit={handleUpdateClient}
        />
      )}
    </div>
  );
}