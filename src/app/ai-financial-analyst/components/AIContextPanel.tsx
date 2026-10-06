'use client';
import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';
import { type ActiveAnalysisType } from './AIAnalystLayout';
import { useCurrency } from '@/lib/currency';
import { useActiveClient } from '@/lib/activeClient';

interface Props {
  activeAnalysis: ActiveAnalysisType;
  onCollapse: () => void;
  collapsed: boolean;
}

// [UBAH] Skor, risiko, dan insight contoh dikosongkan -- diisi backend AI
// setelah client aktif punya cukup data transaksi untuk dianalisis.
const healthMetrics: { label: string; score: number; trend: 'up' | 'down' | 'stable'; color: string }[] = [
  { label: 'Liquidity', score: 0, trend: 'stable', color: 'text-muted-foreground' },
  { label: 'Profitability', score: 0, trend: 'stable', color: 'text-muted-foreground' },
  { label: 'Cash Flow', score: 0, trend: 'stable', color: 'text-muted-foreground' },
  { label: 'Solvency', score: 0, trend: 'stable', color: 'text-muted-foreground' },
  { label: 'Working Capital', score: 0, trend: 'stable', color: 'text-muted-foreground' },
];

const keyRisks: { id: string; title: string; severity: string; icon: string; color: string; bg: string; border: string }[] = [];

const aiInsights: { id: string; type: string; title: string; desc: string }[] = [];

const dataSources = [
  { name: 'Financial Statements', status: 'connected', updated: '—' },
  { name: 'General Ledger', status: 'connected', updated: '—' },
  { name: 'Transactions', status: 'connected', updated: '—' },
  { name: 'Budget Report', status: 'connected', updated: '—' },
  { name: 'AR Module', status: 'connected', updated: '—' },
  { name: 'AP Module', status: 'connected', updated: '—' },
];

export default function AIContextPanel({ activeAnalysis, onCollapse, collapsed }: Props) {
  const { fx } = useCurrency();
  const { activeClientName } = useActiveClient();
  const [expandedSection, setExpandedSection] = useState<string | null>('confidence');

  const toggleSection = (id: string) => {
    setExpandedSection(expandedSection === id ? null : id);
  };

  if (collapsed) return null;

  const overallScore = 0;
  const confidence = 0;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin flex flex-col">
      {/* Header */}
      <div className="sticky top-0 bg-card border-b border-border px-4 py-3 z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="InformationCircleIcon" size={15} className="text-ai-purple" />
          <span className="text-sm font-semibold text-foreground">Analysis Context</span>
        </div>
        <button onClick={onCollapse} className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors">
          <Icon name="ChevronRightIcon" size={14} />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* AI Confidence */}
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('confidence')}
            className="w-full flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Icon name="CpuChipIcon" size={14} className="text-ai-purple" />
              <span className="text-sm font-semibold text-foreground">AI Confidence</span>
            </div>
            <Icon name={expandedSection === 'confidence' ? 'ChevronUpIcon' : 'ChevronDownIcon'} size={13} className="text-muted-foreground" />
          </button>
          {expandedSection === 'confidence' && (
            <div className="px-3 pb-3 border-t border-border">
              <div className="flex items-center gap-3 mt-3">
                <div className="relative w-16 h-16 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="14" fill="none" stroke="var(--border)" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="14" fill="none"
                      stroke="var(--ai-purple)" strokeWidth="3"
                      strokeDasharray={`${(confidence / 100) * 87.96} 87.96`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs font-bold text-foreground">{confidence}%</span>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-bold text-ai-purple">{confidence > 0 ? 'High Confidence' : 'No analysis yet'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Based on {dataSources.length} connected data sources</p>
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                {dataSources.map((ds) => (
                  <div key={`ds-${ds.name}`} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
                      <span className="text-foreground">{ds.name}</span>
                    </div>
                    <span className="text-muted-foreground">{ds.updated}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Financial Health */}
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('health')}
            className="w-full flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Icon name="HeartIcon" size={14} className="text-success" />
              <span className="text-sm font-semibold text-foreground">Financial Health</span>
            </div>
            <Icon name={expandedSection === 'health' ? 'ChevronUpIcon' : 'ChevronDownIcon'} size={13} className="text-muted-foreground" />
          </button>
          {expandedSection === 'health' && (
            <div className="px-3 pb-3 border-t border-border">
              <div className="flex items-center gap-3 mt-3 mb-3">
                <div className="relative w-14 h-14 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="14" fill="none" stroke="var(--border)" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="14" fill="none"
                      stroke="var(--success)" strokeWidth="3"
                      strokeDasharray={`${(overallScore / 100) * 87.96} 87.96`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs font-bold text-foreground">{overallScore}</span>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-bold text-success">{overallScore} / 100</p>
                  <p className="text-2xs text-muted-foreground">{overallScore > 0 ? 'Good financial health' : 'Not enough data yet'}</p>
                </div>
              </div>
              <div className="space-y-2">
                {healthMetrics.map((m) => (
                  <div key={`hm-${m.label}`}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{m.label}</span>
                      <div className="flex items-center gap-1">
                        <span className={`font-semibold tabular-nums ${m.color}`}>{m.score}</span>
                        <Icon
                          name={m.trend === 'up' ? 'ArrowTrendingUpIcon' : m.trend === 'down' ? 'ArrowTrendingDownIcon' : 'MinusIcon'}
                          size={10}
                          className={m.trend === 'up' ? 'text-success' : m.trend === 'down' ? 'text-danger' : 'text-muted-foreground'}
                        />
                      </div>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${m.score >= 80 ? 'bg-success' : m.score >= 65 ? 'bg-warning' : 'bg-danger'}`}
                        style={{ width: `${m.score}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Key Risks */}
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('risks')}
            className="w-full flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Icon name="ExclamationTriangleIcon" size={14} className="text-danger" />
              <span className="text-sm font-semibold text-foreground">Key Risks</span>
              <span className="text-2xs bg-danger-bg text-danger-foreground px-1.5 py-0.5 rounded-full font-semibold">{keyRisks.length}</span>
            </div>
            <Icon name={expandedSection === 'risks' ? 'ChevronUpIcon' : 'ChevronDownIcon'} size={13} className="text-muted-foreground" />
          </button>
          {expandedSection === 'risks' && (
            <div className="px-3 pb-3 border-t border-border">
              {keyRisks.length === 0 && (
                <p className="text-xs text-muted-foreground mt-3">No risks flagged yet.</p>
              )}
              <div className="space-y-2 mt-3">
                {keyRisks.map((risk) => (
                  <div key={risk.id} className={`flex items-start gap-2 p-2 rounded-md border ${risk.bg} ${risk.border}`}>
                    <Icon name={risk.icon as any} size={13} className={`${risk.color} flex-shrink-0 mt-0.5`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground leading-relaxed">{fx(risk.title)}</p>
                    </div>
                    <span className={`text-2xs font-bold flex-shrink-0 ${risk.color}`}>{risk.severity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* AI Insights */}
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('insights')}
            className="w-full flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Icon name="SparklesIcon" size={14} className="text-ai-purple" />
              <span className="text-sm font-semibold text-foreground">AI Insights</span>
              <span className="text-2xs bg-ai-purple-bg text-ai-purple px-1.5 py-0.5 rounded-full font-semibold">{aiInsights.length}</span>
            </div>
            <Icon name={expandedSection === 'insights' ? 'ChevronUpIcon' : 'ChevronDownIcon'} size={13} className="text-muted-foreground" />
          </button>
          {expandedSection === 'insights' && (
            <div className="px-3 pb-3 border-t border-border">
              {aiInsights.length === 0 && (
                <p className="text-xs text-muted-foreground mt-3">No insights yet.</p>
              )}
              <div className="space-y-2 mt-3">
                {aiInsights.map((ins) => (
                  <div
                    key={ins.id}
                    className={`p-2.5 rounded-md border text-xs ${
                      ins.type === 'critical' ? 'bg-danger-bg border-red-200' :
                      ins.type === 'warning' ? 'bg-warning-bg border-yellow-200' :
                      ins.type === 'positive'? 'bg-success-bg border-green-200' : 'bg-secondary border-border'
                    }`}
                  >
                    <p className="font-semibold text-foreground mb-0.5">{ins.title}</p>
                    <p className="text-muted-foreground leading-relaxed">{ins.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Analysis Scope */}
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('scope')}
            className="w-full flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Icon name="AdjustmentsHorizontalIcon" size={14} className="text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Analysis Scope</span>
            </div>
            <Icon name={expandedSection === 'scope' ? 'ChevronUpIcon' : 'ChevronDownIcon'} size={13} className="text-muted-foreground" />
          </button>
          {expandedSection === 'scope' && (
            <div className="px-3 pb-3 border-t border-border">
              <div className="space-y-2 mt-3 text-xs">
                {[
                  { label: 'Company', value: activeClientName ?? 'No client selected' },
                  { label: 'Period', value: 'Jan 2026 – Aug 2026' },
                  { label: 'Currency', value: 'IDR (Indonesian Rupiah)' },
                  { label: 'Branch', value: 'All Branches' },
                  { label: 'Last Updated', value: '—' },
                ].map((row) => (
                  <div key={`scope-${row.label}`} className="flex justify-between">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-medium text-foreground text-right max-w-[120px] truncate">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}