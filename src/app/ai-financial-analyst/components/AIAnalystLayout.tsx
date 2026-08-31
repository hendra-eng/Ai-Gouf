'use client';
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import AIConversationSidebar from './AIConversationSidebar';
import AIAnalysisArea from './AIAnalysisArea';
import AIContextPanel from './AIContextPanel';
import NewAnalysisModal from './NewAnalysisModal';
import { aiAnalyses, type AIAnalysis } from '@/lib/mockData';

export type ActiveAnalysisType = 'profit-decrease' | 'ar-risk' | 'cash-flow' | 'q-comparison' | 'expense-anomaly' | 'ap-risk' | null;

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
    handleSelectAnalysis(type);
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