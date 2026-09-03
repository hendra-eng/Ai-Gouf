'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import dynamic from 'next/dynamic';
import { type ActiveAnalysisType } from './AIAnalystLayout';

const ProfitAnalysis = dynamic(() => import('./analyses/ProfitAnalysis'), { ssr: false });
const ARRiskAnalysis = dynamic(() => import('./analyses/ARRiskAnalysis'), { ssr: false });
const CashFlowAnalysis = dynamic(() => import('./analyses/CashFlowAnalysis'), { ssr: false });
const QuarterComparison = dynamic(() => import('./analyses/QuarterComparison'), { ssr: false });
const ExpenseAnomalyAnalysis = dynamic(() => import('./analyses/ExpenseAnomalyAnalysis'), { ssr: false });
const APRiskAnalysis = dynamic(() => import('./analyses/APRiskAnalysis'), { ssr: false });

interface Props {
  activeAnalysis: ActiveAnalysisType;
  isAnalyzing: boolean;
  onNewAnalysis: () => void;
}

const analysisLabels: Record<NonNullable<ActiveAnalysisType>, string> = {
  'profit-decrease': 'Why did net profit decrease?',
  'ar-risk': 'Analyze receivables risk',
  'cash-flow': 'Explain cash flow',
  'q-comparison': 'Compare Q2 vs Q1',
  'expense-anomaly': 'Find unusual expenses',
  'ap-risk': 'Analyze payables risk',
};

export default function AIAnalysisArea({ activeAnalysis, isAnalyzing, onNewAnalysis }: Props) {
  const router = useRouter();

  if (!activeAnalysis) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
        <div className="w-16 h-16 rounded-2xl bg-ai-purple-bg flex items-center justify-center mb-4">
          <Icon name="SparklesIcon" size={28} className="text-ai-purple" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">AI Financial Analyst</h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-md">
          Select an analysis from the sidebar, ask a suggested question, or start a new analysis to get AI-powered financial insights.
        </p>
        <button
          onClick={onNewAnalysis}
          className="flex items-center gap-2 bg-ai-purple text-white font-medium rounded-lg px-5 py-2.5 hover:bg-purple-700 transition-colors"
        >
          <Icon name="PlusIcon" size={16} />
          Start New Analysis
        </button>
      </div>
    );
  }

  if (isAnalyzing) {
    return <AnalyzingSkeleton label={analysisLabels[activeAnalysis]} />;
  }

  return (
    <div className="space-y-6">
      {/* Analysis header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-md bg-ai-purple-bg flex items-center justify-center">
              <Icon name="SparklesIcon" size={13} className="text-ai-purple" />
            </div>
            <span className="text-xs font-semibold text-ai-purple uppercase tracking-wider">AI Financial Analysis</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{analysisLabels[activeAnalysis]}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">PT Nusantara Teknologi Indonesia · Jan–Aug 2026 · Confidence: 94%</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => toast.success('Analysis saved')} className="flex items-center gap-1.5 text-sm border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors">
            <Icon name="BookmarkIcon" size={13} />
            Save
          </button>
          <button onClick={() => toast.success('Exporting analysis...')} className="flex items-center gap-1.5 text-sm border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors">
            <Icon name="ArrowDownTrayIcon" size={13} />
            Export
          </button>
          <button
            onClick={() => {
              toast.success('Report created — redirecting to Reports');
              setTimeout(() => router.push('/reports'), 1000);
            }}
            className="flex items-center gap-1.5 text-sm bg-primary text-white rounded-md px-2.5 py-1.5 hover:bg-primary/90 transition-colors"
          >
            <Icon name="DocumentChartBarIcon" size={13} />
            Create Report
          </button>
        </div>
      </div>

      {/* Recommended Actions Bar */}
      <div className="flex items-center gap-2 p-3 bg-ai-purple-bg border border-purple-200 rounded-lg flex-wrap">
        <span className="text-xs font-semibold text-ai-purple mr-1">Recommended Actions:</span>
        {[
          { label: 'Analyze Further', icon: 'MagnifyingGlassIcon', action: () => toast.info('Opening deeper analysis...') },
          { label: 'View Transactions', icon: 'CurrencyDollarIcon', action: () => router.push('/transactions') },
          { label: 'View AR Aging', icon: 'ArrowTrendingUpIcon', action: () => router.push('/accounts-receivable') },
          { label: 'View AP Aging', icon: 'ArrowTrendingDownIcon', action: () => router.push('/accounts-payable') },
          { label: 'View Report', icon: 'DocumentChartBarIcon', action: () => router.push('/reports') },
        ].map((action) => (
          <button
            key={`action-${action.label}`}
            onClick={action.action}
            className="flex items-center gap-1 text-xs text-ai-purple-foreground bg-white border border-purple-200 rounded-md px-2.5 py-1.5 hover:bg-purple-50 transition-colors font-medium"
          >
            <Icon name={action.icon as any} size={12} />
            {action.label}
          </button>
        ))}
      </div>

      {/* Analysis content */}
      {activeAnalysis === 'profit-decrease' && <ProfitAnalysis />}
      {activeAnalysis === 'ar-risk' && <ARRiskAnalysis />}
      {activeAnalysis === 'cash-flow' && <CashFlowAnalysis />}
      {activeAnalysis === 'q-comparison' && <QuarterComparison />}
      {activeAnalysis === 'expense-anomaly' && <ExpenseAnomalyAnalysis />}
      {activeAnalysis === 'ap-risk' && <APRiskAnalysis />}
    </div>
  );
}

function AnalyzingSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 p-4 bg-ai-purple-bg border border-purple-200 rounded-lg">
        <div className="w-8 h-8 rounded-full bg-ai-purple flex items-center justify-center">
          <Icon name="SparklesIcon" size={16} className="text-white animate-spin" />
        </div>
        <div>
          <p className="text-sm font-semibold text-ai-purple">Analyzing: {label}</p>
          <p className="text-xs text-ai-purple-foreground mt-0.5">Processing financial data across all modules...</p>
        </div>
      </div>
      {[280, 200, 160, 120].map((h, i) => (
        <div key={`skel-${i}`} className="bg-card border border-border rounded-lg p-5">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-secondary rounded w-1/3" />
            <div className="h-3 bg-secondary rounded w-full" />
            <div className="h-3 bg-secondary rounded w-4/5" />
            <div className="h-3 bg-secondary rounded w-3/5" />
            <div className={`bg-secondary rounded mt-4`} style={{ height: h - 80 }} />
          </div>
        </div>
      ))}
    </div>
  );
}