'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { type AIAnalysis } from '@/lib/mockData';
import { type ActiveAnalysisType } from './AIAnalystLayout';

const suggestedQuestions: { id: string; label: string; type: ActiveAnalysisType }[] = [
  { id: 'sq-profit', label: 'Why did profit change?', type: 'profit-decrease' },
  { id: 'sq-expenses', label: 'What is driving our expenses?', type: 'expense-anomaly' },
  { id: 'sq-ar-risk', label: 'Which customers have the highest credit risk?', type: 'ar-risk' },
  { id: 'sq-budget', label: 'Where are we over budget?', type: 'profit-decrease' },
  { id: 'sq-cash', label: 'How healthy is our cash position?', type: 'cash-flow' },
  { id: 'sq-forecast', label: 'Forecast the next quarter.', type: 'q-comparison' },
  { id: 'sq-margin', label: 'What is causing margin pressure?', type: 'profit-decrease' },
  { id: 'sq-vendor', label: 'Which vendors have the largest exposure?', type: 'ap-risk' },
  { id: 'sq-anomaly', label: 'Are there unusual journal entries?', type: 'expense-anomaly' },
  { id: 'sq-risks', label: 'What are our biggest financial risks?', type: 'ar-risk' },
  { id: 'sq-mgmt', label: 'What should management focus on this month?', type: 'profit-decrease' },
];

interface Props {
  analyses: AIAnalysis[];
  activeAnalysis: ActiveAnalysisType;
  onSelectAnalysis: (type: ActiveAnalysisType) => void;
  onNewAnalysis: () => void;
  onDeleteAnalysis: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onRenameAnalysis: (id: string, title: string) => void;
  onDuplicateAnalysis: (id: string) => void;
  onArchiveAnalysis: (id: string) => void;
  onToggleCollapse: () => void;
}

// [RAPI] createdAt di-parse jadi tanggal ISO lokal (bukan string literal
// hardcoded) supaya grouping TODAY/YESTERDAY/EARLIER selalu benar relatif ke
// hari ini, tidak cuma cocok untuk seed data tertentu.
function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function AIConversationSidebar({
  analyses,
  activeAnalysis,
  onSelectAnalysis,
  onNewAnalysis,
  onDeleteAnalysis,
  onToggleFavorite,
  onRenameAnalysis,
  onDuplicateAnalysis,
  onArchiveAnalysis,
  onToggleCollapse,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const filteredAnalyses = analyses.filter(
    (a) =>
      !a.isArchived &&
      (searchQuery === '' || a.title.toLowerCase().includes(searchQuery.toLowerCase()) || a.type.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const todayStr = toISODate(new Date());
  const yesterdayStr = toISODate(new Date(Date.now() - 86400000));

  const today = filteredAnalyses.filter((a) => a.createdAt === todayStr);
  const yesterday = filteredAnalyses.filter((a) => a.createdAt === yesterdayStr);
  const earlier = filteredAnalyses.filter((a) => a.createdAt !== todayStr && a.createdAt !== yesterdayStr);

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-ai-purple flex items-center justify-center">
              <Icon name="SparklesIcon" size={13} className="text-white" />
            </div>
            <span className="text-sm font-bold text-foreground">AI Analyst</span>
          </div>
          <button onClick={onToggleCollapse} className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors">
            <Icon name="ChevronLeftIcon" size={14} />
          </button>
        </div>

        <button
          onClick={onNewAnalysis}
          className="w-full flex items-center justify-center gap-1.5 bg-ai-purple text-white text-sm font-medium rounded-md py-2 hover:bg-purple-700 transition-colors"
        >
          <Icon name="PlusIcon" size={14} />
          New Analysis
        </button>

        {/* Search */}
        <div className="flex items-center gap-1.5 bg-secondary rounded-md px-2.5 py-1.5 mt-2">
          <Icon name="MagnifyingGlassIcon" size={13} className="text-muted-foreground" />
          <input
            type="text"
            placeholder="Search analyses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none w-full"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-foreground">
              <Icon name="XMarkIcon" size={12} />
            </button>
          )}
        </div>
      </div>

      {/* History */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-2">
        {filteredAnalyses.length === 0 && searchQuery && (
          <div className="px-3 py-6 text-center">
            <Icon name="MagnifyingGlassIcon" size={24} className="text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No analyses match &quot;{searchQuery}&quot;</p>
          </div>
        )}

        {today.length > 0 && (
          <div className="mb-2">
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1.5">TODAY</p>
            {today.map((a) => (
              <AnalysisItem
                key={a.id}
                analysis={a}
                isActive={a.analysisType === activeAnalysis}
                onSelect={() => onSelectAnalysis(a.analysisType)}
                onContextMenu={(e) => handleContextMenu(e, a.id)}
                onDelete={() => onDeleteAnalysis(a.id)}
              />
            ))}
          </div>
        )}

        {yesterday.length > 0 && (
          <div className="mb-2">
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1.5">YESTERDAY</p>
            {yesterday.map((a) => (
              <AnalysisItem
                key={a.id}
                analysis={a}
                isActive={a.analysisType === activeAnalysis}
                onSelect={() => onSelectAnalysis(a.analysisType)}
                onContextMenu={(e) => handleContextMenu(e, a.id)}
                onDelete={() => onDeleteAnalysis(a.id)}
              />
            ))}
          </div>
        )}

        {earlier.length > 0 && (
          <div className="mb-2">
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1.5">EARLIER</p>
            {earlier.map((a) => (
              <AnalysisItem
                key={a.id}
                analysis={a}
                isActive={a.analysisType === activeAnalysis}
                onSelect={() => onSelectAnalysis(a.analysisType)}
                onContextMenu={(e) => handleContextMenu(e, a.id)}
                onDelete={() => onDeleteAnalysis(a.id)}
              />
            ))}
          </div>
        )}

        {/* Suggested Questions */}
        {!searchQuery && (
          <div className="mt-2">
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1.5">SUGGESTED</p>
            {suggestedQuestions.map((q) => (
              <button
                key={q.id}
                onClick={() => onSelectAnalysis(q.type)}
                className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors flex items-start gap-2 group"
              >
                <Icon name="SparklesIcon" size={12} className="text-ai-purple mt-0.5 flex-shrink-0 opacity-60 group-hover:opacity-100" />
                <span className="leading-relaxed">{q.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-card border border-border rounded-lg shadow-dropdown py-1 min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseLeave={() => setContextMenu(null)}
        >
          {[
            {
              icon: 'PencilIcon',
              label: 'Rename',
              action: () => {
                const current = analyses.find((a) => a.id === contextMenu.id);
                const nextTitle = window.prompt('Rename analysis', current?.title || '');
                if (nextTitle && nextTitle.trim()) {
                  onRenameAnalysis(contextMenu.id, nextTitle.trim());
                  toast.success('Analysis renamed');
                }
              },
            },
            {
              icon: 'StarIcon',
              label: analyses.find((a) => a.id === contextMenu.id)?.isFavorite ? 'Unfavorite' : 'Favorite',
              action: () => {
                onToggleFavorite(contextMenu.id);
                toast.success('Favorite updated');
              },
            },
            {
              icon: 'DocumentDuplicateIcon',
              label: 'Duplicate',
              action: () => { onDuplicateAnalysis(contextMenu.id); toast.success('Analysis duplicated'); },
            },
            {
              icon: 'ArchiveBoxIcon',
              label: 'Archive',
              action: () => { onArchiveAnalysis(contextMenu.id); toast.info('Analysis archived'); },
            },
            { icon: 'TrashIcon', label: 'Delete', action: () => { onDeleteAnalysis(contextMenu.id); setContextMenu(null); toast.success('Analysis deleted'); }, danger: true },
          ].map((item) => (
            <button
              key={`ctx-${item.label}`}
              onClick={() => { item.action(); setContextMenu(null); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-secondary ${item.danger ? 'text-danger' : 'text-foreground'}`}
            >
              <Icon name={item.icon as any} size={13} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisItem({
  analysis,
  isActive,
  onSelect,
  onContextMenu,
  onDelete,
}: {
  analysis: AIAnalysis;
  isActive: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDelete: () => void;
}) {
  const riskDot: Record<string, string> = {
    Critical: 'bg-danger',
    High: 'bg-orange-500',
    Medium: 'bg-warning',
    Low: 'bg-success',
  };

  return (
    <div
      className={`group flex items-center gap-2 mx-2 px-2 py-2 rounded-md cursor-pointer transition-colors ${
        isActive ? 'bg-ai-purple-bg text-ai-purple' : 'hover:bg-secondary text-foreground'
      }`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${riskDot[analysis.risk] || 'bg-muted-foreground'}`} />
      <span className="text-xs flex-1 truncate">{analysis.title}</span>
      {analysis.isFavorite && <Icon name="StarIcon" size={11} className="text-warning flex-shrink-0" />}
      <button
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-danger-bg text-muted-foreground hover:text-danger transition-all"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        <Icon name="XMarkIcon" size={11} />
      </button>
    </div>
  );
}