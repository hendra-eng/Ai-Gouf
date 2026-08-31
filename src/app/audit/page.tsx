'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircleIcon, PlusIcon, ArrowDownTrayIcon, FunnelIcon, MagnifyingGlassIcon, XMarkIcon, PaperClipIcon,  } from '@heroicons/react/24/outline';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

// ─── Types ───────────────────────────────────────────────────────────────────

type FindingRisk = 'Low' | 'Medium' | 'High' | 'Critical';
type FindingStatus = 'Open' | 'Under Review' | 'Management Response' | 'Resolved' | 'Accepted';

interface AuditFinding {
  id: string;
  area: string;
  description: string;
  account: string;
  amount: number;
  risk: FindingRisk;
  assignedTo: string;
  dueDate: string;
  status: FindingStatus;
  rootCause: string;
  recommendation: string;
  managementResponse: string;
  likelihood: number; // 1-5
  impact: number; // 1-5
}

interface AuditActivity {
  id: string;
  user: string;
  action: string;
  module: string;
  record: string;
  timestamp: string;
  prevValue?: string;
  newValue?: string;
}

// ─── Data ────────────────────────────────────────────────────────────────────

const auditStages = [
  { id: 'planning', label: 'Planning', date: '1 Jun 2026', done: true },
  { id: 'fieldwork', label: 'Fieldwork', date: '15 Jun 2026', done: true },
  { id: 'testing', label: 'Testing', date: 'In Progress', done: false, current: true },
  { id: 'review', label: 'Review', date: 'Pending', done: false },
  { id: 'mgmt-response', label: 'Mgmt Response', date: 'Pending', done: false },
  { id: 'finalization', label: 'Finalization', date: 'Pending', done: false },
];

const findings: AuditFinding[] = [
  {
    id: 'AUD-001', area: 'Revenue Recognition', description: 'Revenue recorded before delivery confirmation received',
    account: 'Revenue', amount: 45_000_000, risk: 'High', assignedTo: 'Budi S.', dueDate: '15 Sep 2026',
    status: 'Open', likelihood: 4, impact: 4,
    rootCause: 'Lack of automated delivery confirmation integration with billing system.',
    recommendation: 'Implement automated delivery confirmation before revenue recognition.',
    managementResponse: '',
  },
  {
    id: 'AUD-002', area: 'Accounts Receivable', description: 'AR aging >90 days not provisioned per policy',
    account: 'Accounts Receivable', amount: 120_000_000, risk: 'Critical', assignedTo: 'Sari W.', dueDate: '10 Sep 2026',
    status: 'Under Review', likelihood: 5, impact: 5,
    rootCause: 'Provisioning policy not applied to overdue balances exceeding 90 days.',
    recommendation: 'Create provision of Rp 120M and review credit policy for high-risk customers.',
    managementResponse: 'Finance team is reviewing the aging schedule and will create provisions by Sep 10.',
  },
  {
    id: 'AUD-003', area: 'Fixed Assets', description: 'Depreciation calculation error — wrong useful life applied',
    account: 'Depreciation Expense', amount: 28_000_000, risk: 'Medium', assignedTo: 'Ahmad R.', dueDate: '20 Sep 2026',
    status: 'Open', likelihood: 3, impact: 3,
    rootCause: 'Asset register not updated with revised useful life estimates.',
    recommendation: 'Recalculate depreciation using correct useful life and adjust journal entries.',
    managementResponse: '',
  },
  {
    id: 'AUD-004', area: 'Cash & Bank', description: 'Unreconciled bank items outstanding >30 days',
    account: 'Cash & Bank', amount: 15_000_000, risk: 'Low', assignedTo: 'Dewi P.', dueDate: '25 Sep 2026',
    status: 'Resolved', likelihood: 2, impact: 2,
    rootCause: 'Bank reconciliation process not performed on schedule.',
    recommendation: 'Implement weekly bank reconciliation process.',
    managementResponse: 'Bank reconciliation completed. All items cleared.',
  },
  {
    id: 'AUD-005', area: 'Payroll', description: 'Overtime calculation discrepancy in August payroll',
    account: 'Salaries Expense', amount: 8_000_000, risk: 'Medium', assignedTo: 'Budi S.', dueDate: '18 Sep 2026',
    status: 'Management Response', likelihood: 3, impact: 2,
    rootCause: 'Overtime rate formula error in payroll system.',
    recommendation: 'Correct payroll system formula and reprocess affected employees.',
    managementResponse: 'HR has identified the formula error. Correction will be applied in September payroll.',
  },
  {
    id: 'AUD-006', area: 'Tax', description: 'VAT input credit not claimed for eligible purchases',
    account: 'Tax Payable', amount: 32_000_000, risk: 'High', assignedTo: 'Sari W.', dueDate: '12 Sep 2026',
    status: 'Open', likelihood: 4, impact: 3,
    rootCause: 'Tax team not reviewing all purchase invoices for VAT credit eligibility.',
    recommendation: 'Review all purchase invoices from Jan-Aug 2026 and claim eligible VAT credits.',
    managementResponse: '',
  },
  {
    id: 'AUD-007', area: 'Inventory', description: 'Stock count variance between system and physical count',
    account: 'Inventory', amount: 18_000_000, risk: 'Medium', assignedTo: 'Ahmad R.', dueDate: '22 Sep 2026',
    status: 'Under Review', likelihood: 3, impact: 3,
    rootCause: 'Inventory movement not recorded in real-time.',
    recommendation: 'Implement real-time inventory tracking and conduct monthly cycle counts.',
    managementResponse: '',
  },
  {
    id: 'AUD-008', area: 'Expenses', description: 'Unsupported expense claims without receipts',
    account: 'Operating Expenses', amount: 12_000_000, risk: 'Low', assignedTo: 'Dewi P.', dueDate: '28 Sep 2026',
    status: 'Open', likelihood: 2, impact: 2,
    rootCause: 'Expense claim policy not enforced consistently.',
    recommendation: 'Reject unsupported claims and strengthen expense approval process.',
    managementResponse: '',
  },
];

const auditActivities = [
  { id: 'a1', user: 'Budi S.', action: 'AUD-002 finding created — AR aging >90 days not provisioned', time: '10:30 AM', date: '28 Aug 2026', type: 'finding' },
  { id: 'a2', user: 'Sari W.', action: 'Evidence uploaded for AUD-001 — delivery confirmation policy', time: '2:15 PM', date: '27 Aug 2026', type: 'evidence' },
  { id: 'a3', user: 'Ahmad R.', action: 'Control test completed — Revenue recognition procedures', time: '9:00 AM', date: '26 Aug 2026', type: 'test' },
  { id: 'a4', user: 'Dewi P.', action: 'AUD-004 resolved — Bank reconciliation completed', time: '4:45 PM', date: '25 Aug 2026', type: 'resolved' },
  { id: 'a5', user: 'Budi S.', action: 'Management response submitted for AUD-005', time: '11:20 AM', date: '24 Aug 2026', type: 'response' },
];

const auditTrail: AuditActivity[] = [
  { id: 't1', user: 'Budi S.', action: 'Modified', module: 'Accounts Receivable', record: 'INV-2026-089', timestamp: '2026-08-28 10:30', prevValue: 'Rp 45M', newValue: 'Rp 50M' },
  { id: 't2', user: 'Sari W.', action: 'Created', module: 'Audit Finding', record: 'AUD-002', timestamp: '2026-08-27 14:15', prevValue: '—', newValue: 'New Finding' },
  { id: 't3', user: 'System', action: 'Auto-flagged', module: 'Revenue', record: 'JE-2026-445', timestamp: '2026-08-26 09:00', prevValue: '—', newValue: 'Anomaly detected' },
  { id: 't4', user: 'Ahmad R.', action: 'Approved', module: 'Expenses', record: 'EXP-2026-440', timestamp: '2026-08-25 16:45', prevValue: 'Pending', newValue: 'Approved' },
  { id: 't5', user: 'Dewi P.', action: 'Resolved', module: 'Audit Finding', record: 'AUD-004', timestamp: '2026-08-25 11:20', prevValue: 'Open', newValue: 'Resolved' },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function RiskBadge({ risk }: { risk: FindingRisk }) {
  const map: Record<FindingRisk, string> = {
    Low: 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]',
    Medium: 'bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]',
    High: 'bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]',
    Critical: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${map[risk]}`}>
      {risk}
    </span>
  );
}

function StatusBadge({ status }: { status: FindingStatus }) {
  const map: Record<FindingStatus, string> = {
    Open: 'bg-[#FEF2F2] text-[#DC2626]',
    'Under Review': 'bg-[#EFF6FF] text-[#1B4FD8]',
    'Management Response': 'bg-[#FFFBEB] text-[#D97706]',
    Resolved: 'bg-[#ECFDF5] text-[#059669]',
    Accepted: 'bg-[#F5F3FF] text-[#7C3AED]',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${map[status]}`}>
      {status}
    </span>
  );
}

function FindingDrawer({ finding, onClose }: { finding: AuditFinding; onClose: () => void }) {
  const { fx } = useCurrency();
  const [activeAction, setActiveAction] = useState<string | null>(null);

  function handleAction(action: string) {
    setActiveAction(action);
    setTimeout(() => setActiveAction(null), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm flex items-start justify-end" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden animate-slide-in-right"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E2E8F0] bg-gradient-to-r from-[#F8FAFC] to-white">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono font-bold text-[#1B4FD8]">{finding.id}</span>
                <RiskBadge risk={finding.risk} />
                <StatusBadge status={finding.status} />
              </div>
              <h2 className="text-sm font-bold text-[#0F172A]">{finding.description}</h2>
              <p className="text-xs text-[#64748B] mt-0.5">{finding.area} · {finding.account}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#F8FAFC] transition-colors">
              <XMarkIcon className="w-4 h-4 text-[#64748B]" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Financial Impact */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-[#FEF2F2] rounded-lg border border-[#FECACA]">
              <p className="text-[10px] text-[#94A3B8] mb-1">Financial Impact</p>
              <p className="text-sm font-bold font-mono text-[#DC2626]">{fx(formatIDR(finding.amount))}</p>
            </div>
            <div className="p-3 bg-[#F8FAFC] rounded-lg border border-[#E2E8F0]">
              <p className="text-[10px] text-[#94A3B8] mb-1">Assigned To</p>
              <p className="text-sm font-semibold text-[#0F172A]">{finding.assignedTo}</p>
            </div>
            <div className="p-3 bg-[#F8FAFC] rounded-lg border border-[#E2E8F0]">
              <p className="text-[10px] text-[#94A3B8] mb-1">Due Date</p>
              <p className="text-sm font-semibold text-[#0F172A]">{finding.dueDate}</p>
            </div>
          </div>

          {/* Risk Assessment */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-2">Risk Assessment</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-[#F8FAFC] rounded-lg border border-[#E2E8F0]">
                <p className="text-[10px] text-[#64748B] mb-1">Likelihood</p>
                <div className="flex gap-1">
                  {[1,2,3,4,5].map(n => (
                    <div key={n} className={`h-2 flex-1 rounded-sm ${n <= finding.likelihood ? 'bg-[#DC2626]' : 'bg-[#E2E8F0]'}`} />
                  ))}
                </div>
                <p className="text-[10px] text-[#94A3B8] mt-1">{finding.likelihood}/5</p>
              </div>
              <div className="p-3 bg-[#F8FAFC] rounded-lg border border-[#E2E8F0]">
                <p className="text-[10px] text-[#64748B] mb-1">Impact</p>
                <div className="flex gap-1">
                  {[1,2,3,4,5].map(n => (
                    <div key={n} className={`h-2 flex-1 rounded-sm ${n <= finding.impact ? 'bg-[#D97706]' : 'bg-[#E2E8F0]'}`} />
                  ))}
                </div>
                <p className="text-[10px] text-[#94A3B8] mt-1">{finding.impact}/5</p>
              </div>
            </div>
          </div>

          {/* Root Cause */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-2">Root Cause</p>
            <p className="text-xs text-[#0F172A] leading-relaxed bg-[#FFFBEB] p-3 rounded-lg border border-[#FDE68A]">{finding.rootCause}</p>
          </div>

          {/* Recommendation */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-2">Recommendation</p>
            <p className="text-xs text-[#0F172A] leading-relaxed bg-[#EFF6FF] p-3 rounded-lg border border-[#DBEAFE]">{fx(finding.recommendation)}</p>
          </div>

          {/* Management Response */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-2">Management Response</p>
            {finding.managementResponse ? (
              <p className="text-xs text-[#0F172A] leading-relaxed bg-[#ECFDF5] p-3 rounded-lg border border-[#A7F3D0]">{finding.managementResponse}</p>
            ) : (
              <div className="p-3 bg-[#F8FAFC] rounded-lg border border-dashed border-[#CBD5E1] text-center">
                <p className="text-xs text-[#94A3B8]">No management response yet</p>
              </div>
            )}
          </div>

          {/* Evidence */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-2">Evidence</p>
            <div className="space-y-1.5">
              {finding.id === 'AUD-002' ? (
                <>
                  <div className="flex items-center gap-2 p-2 bg-[#F8FAFC] rounded-lg border border-[#E2E8F0]">
                    <PaperClipIcon className="w-3.5 h-3.5 text-[#64748B]" />
                    <span className="text-xs text-[#0F172A] flex-1">AR_Aging_Aug2026.xlsx</span>
                    <span className="text-[10px] text-[#94A3B8]">284 KB</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 bg-[#F8FAFC] rounded-lg border border-[#E2E8F0]">
                    <PaperClipIcon className="w-3.5 h-3.5 text-[#64748B]" />
                    <span className="text-xs text-[#0F172A] flex-1">Customer_Statements.pdf</span>
                    <span className="text-[10px] text-[#94A3B8]">1.2 MB</span>
                  </div>
                </>
              ) : (
                <div className="p-3 bg-[#F8FAFC] rounded-lg border border-dashed border-[#CBD5E1] text-center">
                  <p className="text-xs text-[#94A3B8]">No evidence attached</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 px-5 py-4 border-t border-[#E2E8F0] bg-[#F8FAFC]">
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Review', color: 'bg-[#EFF6FF] text-[#1B4FD8] border-[#DBEAFE]' },
              { label: 'Add Evidence', color: 'bg-[#F5F3FF] text-[#7C3AED] border-[#EDE9FE]' },
              { label: 'Resolve', color: 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]' },
              { label: 'Escalate', color: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]' },
            ].map(({ label, color }) => (
              <button
                key={label}
                onClick={() => handleAction(label)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all hover:opacity-80 ${color} ${activeAction === label ? 'opacity-60' : ''}`}
              >
                {activeAction === label ? '✓ Done' : label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Risk Heatmap ─────────────────────────────────────────────────────────────

function RiskHeatmap({ findings, onFindingClick }: { findings: AuditFinding[]; onFindingClick: (f: AuditFinding) => void }) {
  const [hoveredFinding, setHoveredFinding] = useState<string | null>(null);

  const cellColor = (likelihood: number, impact: number): string => {
    const score = likelihood * impact;
    if (score >= 16) return 'bg-[#FEF2F2] border-[#FECACA]';
    if (score >= 9) return 'bg-[#FFF7ED] border-[#FED7AA]';
    if (score >= 4) return 'bg-[#FFFBEB] border-[#FDE68A]';
    return 'bg-[#ECFDF5] border-[#A7F3D0]';
  };

  const dotColor = (risk: FindingRisk): string => {
    if (risk === 'Critical') return 'bg-[#DC2626]';
    if (risk === 'High') return 'bg-[#EA580C]';
    if (risk === 'Medium') return 'bg-[#D97706]';
    return 'bg-[#059669]';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#0F172A]">Risk Matrix</h3>
        <div className="flex items-center gap-3 text-[10px] text-[#64748B]">
          {(['Critical', 'High', 'Medium', 'Low'] as FindingRisk[]).map(r => (
            <div key={r} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${dotColor(r)}`} />
              {r}
            </div>
          ))}
        </div>
      </div>

      <div className="relative">
        {/* Y-axis label */}
        <div className="absolute -left-6 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] whitespace-nowrap">
          Likelihood →
        </div>

        <div className="ml-2">
          {/* Grid */}
          <div className="grid grid-cols-5 gap-1 mb-1">
            {[5,4,3,2,1].map(likelihood => (
              [1,2,3,4,5].map(impact => {
                const cellFindings = findings.filter(f => f.likelihood === likelihood && f.impact === impact);
                return (
                  <div
                    key={`${likelihood}-${impact}`}
                    className={`relative h-12 rounded-lg border flex items-center justify-center ${cellColor(likelihood, impact)}`}
                  >
                    {cellFindings.map(f => (
                      <button
                        key={f.id}
                        onClick={() => onFindingClick(f)}
                        onMouseEnter={() => setHoveredFinding(f.id)}
                        onMouseLeave={() => setHoveredFinding(null)}
                        className={`w-5 h-5 rounded-full ${dotColor(f.risk)} flex items-center justify-center text-white text-[8px] font-bold hover:scale-125 transition-transform shadow-sm`}
                        title={`${f.id}: ${f.description}`}
                      >
                        {f.id.replace('AUD-', '')}
                      </button>
                    ))}
                    {hoveredFinding && cellFindings.find(f => f.id === hoveredFinding) && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 w-40 bg-[#0F172A] text-white text-[10px] rounded-lg p-2 z-10 pointer-events-none">
                        {cellFindings.find(f => f.id === hoveredFinding)?.description}
                      </div>
                    )}
                  </div>
                );
              })
            ))}
          </div>

          {/* X-axis labels */}
          <div className="grid grid-cols-5 gap-1">
            {['Low', 'Minor', 'Moderate', 'Major', 'Critical'].map(label => (
              <div key={label} className="text-center text-[9px] text-[#94A3B8] font-medium">{label}</div>
            ))}
          </div>
          <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] mt-1">Impact →</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AuditPage() {
  const { fx } = useCurrency();
  const [activeTab, setActiveTab] = useState<'all' | 'open' | 'high-risk' | 'resolved'>('all');
  const [selectedFinding, setSelectedFinding] = useState<AuditFinding | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeStage, setActiveStage] = useState('testing');
  const [trailFilter, setTrailFilter] = useState('');

  const filteredFindings = findings.filter(f => {
    const matchesSearch = !searchQuery || f.description.toLowerCase().includes(searchQuery.toLowerCase()) || f.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab = activeTab === 'all' || (activeTab === 'open' && f.status === 'Open') || (activeTab === 'high-risk' && (f.risk === 'High' || f.risk === 'Critical')) || (activeTab === 'resolved' && f.status === 'Resolved');
    return matchesSearch && matchesTab;
  });

  const kpis = [
    { label: 'Audit Completion', value: '78%', color: '#1B4FD8', bg: '#EFF6FF', icon: '📊' },
    { label: 'Open Findings', value: '12', color: '#D97706', bg: '#FFFBEB', icon: '🔍' },
    { label: 'High Risk', value: '3', color: '#DC2626', bg: '#FEF2F2', icon: '⚠️' },
    { label: 'Pending Evidence', value: '8', color: '#7C3AED', bg: '#F5F3FF', icon: '📎' },
    { label: 'Adjustments', value: 'Rp 142M', color: '#0284C7', bg: '#F0F9FF', icon: '💰' },
    { label: 'Controls Tested', value: '84%', color: '#059669', bg: '#ECFDF5', icon: '✅' },
  ];

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#0F172A]">Audit Center</h1>
            <p className="text-sm text-[#64748B] mt-0.5">Monitor audit procedures, findings, risks, and supporting evidence.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg">
              <span className="text-xs font-medium text-[#64748B]">FY 2026</span>
              <span className="w-1 h-1 rounded-full bg-[#CBD5E1]" />
              <span className="text-xs font-semibold text-[#1B4FD8]">78% Complete</span>
              <span className="w-1 h-1 rounded-full bg-[#CBD5E1]" />
              <span className="text-xs font-medium text-[#D97706]">Risk: Moderate</span>
            </div>
            <button
              onClick={() => toast.info('Membuka form New Finding')}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#1B4FD8] rounded-lg hover:bg-blue-700 transition-colors"
            >
              <PlusIcon style={{ width: 13, height: 13 }} />
              New Finding
            </button>
            <button
              onClick={() => toast.success('Audit report diekspor')}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#64748B] bg-white border border-[#E2E8F0] rounded-lg hover:bg-[#F8FAFC] transition-colors"
            >
              <ArrowDownTrayIcon style={{ width: 13, height: 13 }} />
              Export
            </button>
          </div>
        </div>

        {/* Audit Progress Hero */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[#0F172A]">Audit Progress</h2>
            <span className="text-xs text-[#64748B]">FY 2026 Annual Audit</span>
          </div>
          <div className="relative">
            {/* Progress line */}
            <div className="absolute top-5 left-0 right-0 h-0.5 bg-[#E2E8F0]" />
            <div className="absolute top-5 left-0 h-0.5 bg-[#1B4FD8] transition-all" style={{ width: '40%' }} />

            <div className="relative flex justify-between">
              {auditStages.map((stage, i) => (
                <button
                  key={stage.id}
                  onClick={() => setActiveStage(stage.id)}
                  className="flex flex-col items-center gap-2 group"
                >
                  <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center z-10 transition-all ${
                    stage.done
                      ? 'bg-[#1B4FD8] border-[#1B4FD8]'
                      : stage.current
                        ? 'bg-white border-[#1B4FD8] ring-4 ring-[#DBEAFE]'
                        : 'bg-white border-[#E2E8F0]'
                  } ${activeStage === stage.id ? 'scale-110' : ''}`}>
                    {stage.done ? (
                      <CheckCircleIcon className="w-5 h-5 text-white" />
                    ) : stage.current ? (
                      <div className="w-3 h-3 rounded-full bg-[#1B4FD8] animate-pulse" />
                    ) : (
                      <span className="text-xs font-bold text-[#CBD5E1]">{i + 1}</span>
                    )}
                  </div>
                  <div className="text-center">
                    <p className={`text-xs font-semibold ${stage.done || stage.current ? 'text-[#0F172A]' : 'text-[#94A3B8]'}`}>
                      {stage.label}
                    </p>
                    <p className={`text-[10px] ${stage.current ? 'text-[#1B4FD8] font-medium' : 'text-[#94A3B8]'}`}>
                      {stage.date}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="bg-white rounded-xl border border-[#E2E8F0] p-4 hover:shadow-sm transition-shadow">
              <p className="text-[10px] font-medium text-[#64748B] mb-2">{kpi.label}</p>
              <p className="text-xl font-bold font-mono" style={{ color: kpi.color }}>{fx(kpi.value)}</p>
            </div>
          ))}
        </div>

        {/* Findings + Risk Matrix */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          {/* Findings Table */}
          <div className="xl:col-span-3 bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
            <div className="p-4 border-b border-[#E2E8F0]">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[#0F172A]">Audit Findings</h2>
                <span className="text-xs text-[#64748B]">{filteredFindings.length} findings</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#94A3B8]" />
                  <input
                    type="text"
                    placeholder="Search findings..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1B4FD8]/30"
                  />
                </div>
                <div className="flex gap-1">
                  {(['all', 'open', 'high-risk', 'resolved'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-2.5 py-1.5 text-[10px] font-medium rounded-md capitalize transition-colors ${
                        activeTab === tab ? 'bg-[#EFF6FF] text-[#1B4FD8]' : 'text-[#64748B] hover:bg-[#F8FAFC]'
                      }`}
                    >
                      {tab.replace('-', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#F1F5F9]">
                    {['ID', 'Area', 'Description', 'Amount', 'Risk', 'Assigned', 'Status'].map(h => (
                      <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] px-4 py-2.5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredFindings.map(finding => (
                    <tr
                      key={finding.id}
                      onClick={() => setSelectedFinding(finding)}
                      className="border-b border-[#F8FAFC] hover:bg-[#F8FAFC] cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 text-xs font-mono font-bold text-[#1B4FD8]">{finding.id}</td>
                      <td className="px-4 py-3 text-xs text-[#64748B] whitespace-nowrap">{finding.area}</td>
                      <td className="px-4 py-3 text-xs text-[#0F172A] max-w-[160px] truncate">{finding.description}</td>
                      <td className="px-4 py-3 text-xs font-mono text-[#DC2626]">{fx(formatIDR(finding.amount))}</td>
                      <td className="px-4 py-3"><RiskBadge risk={finding.risk} /></td>
                      <td className="px-4 py-3 text-xs text-[#64748B]">{finding.assignedTo}</td>
                      <td className="px-4 py-3"><StatusBadge status={finding.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Risk Heatmap */}
          <div className="xl:col-span-2 bg-white rounded-xl border border-[#E2E8F0] p-5">
            <RiskHeatmap findings={findings} onFindingClick={setSelectedFinding} />
          </div>
        </div>

        {/* Audit Timeline */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-5">
          <h2 className="text-sm font-semibold text-[#0F172A] mb-4">Audit Activity Timeline</h2>
          <div className="space-y-0">
            {auditActivities.map((activity, i) => {
              const typeColors: Record<string, string> = {
                finding: 'bg-[#FEF2F2] text-[#DC2626]',
                evidence: 'bg-[#F5F3FF] text-[#7C3AED]',
                test: 'bg-[#EFF6FF] text-[#1B4FD8]',
                resolved: 'bg-[#ECFDF5] text-[#059669]',
                response: 'bg-[#FFFBEB] text-[#D97706]',
              };
              return (
                <div key={activity.id} className="flex gap-4 pb-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${typeColors[activity.type]}`}>
                      {activity.user.split(' ')[0][0]}{activity.user.split(' ')[1]?.[0] ?? ''}
                    </div>
                    {i < auditActivities.length - 1 && <div className="w-0.5 flex-1 bg-[#E2E8F0] mt-1" />}
                  </div>
                  <div className="flex-1 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs font-semibold text-[#0F172A]">{activity.user}</span>
                        <span className="text-xs text-[#64748B] ml-2">{activity.action}</span>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[10px] text-[#94A3B8]">{activity.time}</p>
                        <p className="text-[10px] text-[#94A3B8]">{activity.date}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Audit Trail */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
          <div className="p-4 border-b border-[#E2E8F0]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[#0F172A]">Audit Trail</h2>
              <button
                onClick={() => { setTrailFilter(''); toast.info('Filter audit trail direset'); }}
                className="flex items-center gap-1.5 text-xs text-[#64748B] hover:text-[#0F172A]"
              >
                <FunnelIcon style={{ width: 13, height: 13 }} />
                Filter
              </button>
            </div>
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#94A3B8]" />
              <input
                type="text"
                placeholder="Filter by user, module, or action..."
                value={trailFilter}
                onChange={e => setTrailFilter(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1B4FD8]/30"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#F1F5F9]">
                  {['User', 'Action', 'Module', 'Record', 'Timestamp', 'Previous Value', 'New Value'].map(h => (
                    <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] px-4 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auditTrail
                  .filter(t => !trailFilter || t.user.toLowerCase().includes(trailFilter.toLowerCase()) || t.module.toLowerCase().includes(trailFilter.toLowerCase()) || t.action.toLowerCase().includes(trailFilter.toLowerCase()))
                  .map(trail => (
                    <tr key={trail.id} className="border-b border-[#F8FAFC] hover:bg-[#F8FAFC] transition-colors">
                      <td className="px-4 py-3 text-xs font-semibold text-[#0F172A]">{trail.user}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          trail.action === 'Created' ? 'bg-[#ECFDF5] text-[#059669]' :
                          trail.action === 'Modified' ? 'bg-[#FFFBEB] text-[#D97706]' :
                          trail.action === 'Resolved' ? 'bg-[#EFF6FF] text-[#1B4FD8]' :
                          'bg-[#F5F3FF] text-[#7C3AED]'
                        }`}>{trail.action}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#64748B]">{trail.module}</td>
                      <td className="px-4 py-3 text-xs font-mono text-[#1B4FD8]">{trail.record}</td>
                      <td className="px-4 py-3 text-xs text-[#64748B] whitespace-nowrap">{trail.timestamp}</td>
                      <td className="px-4 py-3 text-xs font-mono text-[#64748B]">{fx(trail.prevValue ?? '—')}</td>
                      <td className="px-4 py-3 text-xs font-mono text-[#0F172A]">{fx(trail.newValue ?? '—')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Finding Drawer */}
      {selectedFinding && (
        <FindingDrawer finding={selectedFinding} onClose={() => setSelectedFinding(null)} />
      )}
    </>
  );
}