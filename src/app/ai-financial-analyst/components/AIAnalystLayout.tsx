'use client';
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import AIConversationSidebar from './AIConversationSidebar';
import AIAnalysisArea from './AIAnalysisArea';
import AIContextPanel from './AIContextPanel';
import NewAnalysisModal from './NewAnalysisModal';
import { aiAnalyses, type AIAnalysis, type AIAnalysisTemplateType } from '@/lib/mockData';

export type ActiveAnalysisType = AIAnalysisTemplateType | null;

// [RAPI] Label & tipe display ("Profitability Analysis", dst.) dipusatkan di
// sini supaya entri baru dari "New Analysis" konsisten dengan seed data di
// mockData.ts, tanpa duplikasi daftar template dari NewAnalysisModal.tsx.
const TEMPLATE_LABELS: Record<Exclude<ActiveAnalysisType, null>, { title: string; type: string }> = {
  'profit-decrease': { title: 'Why did net profit decrease?', type: 'Profitability Analysis' },
  'ar-risk': { title: 'Analyze receivables risk', type: 'Receivables Risk' },
  'ap-risk': { title: 'Review payables risk', type: 'Payables Risk' },
  'cash-flow': { title: 'Explain cash flow', type: 'Cash Flow Analysis' },
  'q-comparison': { title: 'Compare quarters', type: 'Quarter Comparison' },
  'expense-anomaly': { title: 'Find unusual expenses', type: 'Anomaly Detection' },
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AIAnalystLayout() {
  const searchParams = useSearchParams();
  const [aiSidebarCollapsed, setAiSidebarCollapsed] = useState(false);
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(false);
  const [activeAnalysis, setActiveAnalysis] = useState<ActiveAnalysisType>('profit-decrease');
  const [showNewAnalysis, setShowNewAnalysis] = useState(false);
  const [analyses, setAnalyses] = useState<AIAnalysis[]>(aiAnalyses);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    const analysisParam = searchParams.get('analysis') as ActiveAnalysisType;
    if (analysisParam) {
      setActiveAnalysis(analysisParam);
    }
  }, [searchParams]);

  const handleSelectAnalysis = (type: ActiveAnalysisType) => {
    setIsAnalyzing(true);
    setActiveAnalysis(type);
    setTimeout(() => setIsAnalyzing(false), 1200);
  };

  const handleNewAnalysis = (type: ActiveAnalysisType) => {
    setShowNewAnalysis(false);
    if (type) {
      const label = TEMPLATE_LABELS[type];
      const today = todayISO();
      const newEntry: AIAnalysis = {
        id: `ai-${Date.now()}`,
        title: label.title,
        type: label.type,
        analysisType: type,
        createdAt: today,
        updatedAt: today,
        period: 'Jan–Aug 2026',
        risk: 'Medium',
        isFavorite: false,
        isArchived: false,
      };
      setAnalyses((prev) => [newEntry, ...prev]);
    }
    handleSelectAnalysis(type);
  };

  const handleToggleFavorite = (id: string) => {
    setAnalyses((prev) => prev.map((a) => (a.id === id ? { ...a, isFavorite: !a.isFavorite } : a)));
  };

  const handleRenameAnalysis = (id: string, title: string) => {
    setAnalyses((prev) => prev.map((a) => (a.id === id ? { ...a, title } : a)));
  };

  const handleDuplicateAnalysis = (id: string) => {
    setAnalyses((prev) => {
      const source = prev.find((a) => a.id === id);
      if (!source) return prev;
      const today = todayISO();
      const copy: AIAnalysis = { ...source, id: `ai-${Date.now()}`, title: `${source.title} (Copy)`, createdAt: today, updatedAt: today };
      return [copy, ...prev];
    });
  };

  const handleArchiveAnalysis = (id: string) => {
    setAnalyses((prev) => prev.map((a) => (a.id === id ? { ...a, isArchived: true } : a)));
  };

  return (
    <>
      {/* -m-6 menghilangkan padding bawaan AppLayout (dari root layout.tsx) supaya panel AI full-bleed */}
      <div className="flex -m-6 h-[calc(100vh-4rem)] overflow-hidden">
        {/* AI Conversation Sidebar */}
        <div
          className={`border-r border-border bg-card flex-shrink-0 sidebar-transition ${
            aiSidebarCollapsed ? 'w-0 overflow-hidden' : 'w-64'
          }`}
        >
          <AIConversationSidebar
            analyses={analyses}
            activeAnalysis={activeAnalysis}
            onSelectAnalysis={handleSelectAnalysis}
            onNewAnalysis={() => setShowNewAnalysis(true)}
            onDeleteAnalysis={(id) => setAnalyses((prev) => prev.filter((a) => a.id !== id))}
            onToggleFavorite={handleToggleFavorite}
            onRenameAnalysis={handleRenameAnalysis}
            onDuplicateAnalysis={handleDuplicateAnalysis}
            onArchiveAnalysis={handleArchiveAnalysis}
            onToggleCollapse={() => setAiSidebarCollapsed(true)}
          />
        </div>

        {/* Expand AI sidebar button */}
        {aiSidebarCollapsed && (
          <button
            onClick={() => setAiSidebarCollapsed(false)}
            className="relative z-30 self-start mt-4 bg-card border border-border rounded-r-md p-1.5 hover:bg-secondary transition-colors shadow-card"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M5 3l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-muted-foreground"
              />
            </svg>
          </button>
        )}

        {/* Analysis area */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6">
            <AIAnalysisArea
              activeAnalysis={activeAnalysis}
              isAnalyzing={isAnalyzing}
              onNewAnalysis={() => setShowNewAnalysis(true)}
            />
          </div>

          {/* Context Panel */}
          <div
            className={`border-l border-border bg-card flex-shrink-0 sidebar-transition ${
              contextPanelCollapsed ? 'w-0 overflow-hidden' : 'w-72'
            }`}
          >
            <AIContextPanel
              activeAnalysis={activeAnalysis}
              onCollapse={() => setContextPanelCollapsed(!contextPanelCollapsed)}
              collapsed={contextPanelCollapsed}
            />
          </div>
        </div>
      </div>

      {showNewAnalysis && (
        <NewAnalysisModal onClose={() => setShowNewAnalysis(false)} onStart={handleNewAnalysis} />
      )}
    </>
  );
}