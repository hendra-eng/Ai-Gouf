'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { type ActiveAnalysisType } from './AIAnalystLayout';

interface Props {
  onClose: () => void;
  onStart: (type: ActiveAnalysisType) => void;
}

const templates: { id: ActiveAnalysisType; icon: string; name: string; desc: string; recommended: string }[] = [
  { id: 'profit-decrease', icon: 'ChartBarIcon', name: 'Profitability Analysis', desc: 'Analyze revenue, margins, and profit drivers', recommended: 'Monthly review, margin concerns' },
  { id: 'ar-risk', icon: 'ArrowTrendingUpIcon', name: 'Receivables Risk', desc: 'Assess AR aging, DSO, and collection risk', recommended: 'When AR is growing or overdue' },
  { id: 'ap-risk', icon: 'ArrowTrendingDownIcon', name: 'Payables Risk', desc: 'Review vendor obligations and payment risk', recommended: 'Before cash planning sessions' },
  { id: 'cash-flow', icon: 'BanknotesIcon', name: 'Cash Flow Analysis', desc: 'Understand operating, investing, financing flows', recommended: 'Monthly cash position review' },
  { id: 'q-comparison', icon: 'ArrowsRightLeftIcon', name: 'Quarter Comparison', desc: 'Side-by-side Q1 vs Q2 performance analysis', recommended: 'End of each quarter' },
  { id: 'expense-anomaly', icon: 'MagnifyingGlassIcon', name: 'Anomaly Detection', desc: 'Find unusual expenses and outlier transactions', recommended: 'Monthly audit, budget review' },
];

export default function NewAnalysisModal({ onClose, onStart }: Props) {
  const [selectedTemplate, setSelectedTemplate] = useState<ActiveAnalysisType>(null);
  const [customQuestion, setCustomQuestion] = useState('');
  const [step, setStep] = useState<'template' | 'config'>('template');
  const [isStarting, setIsStarting] = useState(false);

  const handleStart = () => {
    if (!selectedTemplate) { toast.error('Please select an analysis type'); return; }
    setIsStarting(true);
    setTimeout(() => {
      onStart(selectedTemplate);
      toast.success('Analysis started');
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-card-lg w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-xl font-700 text-foreground">New Financial Analysis</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Ask a financial question or choose an analysis template.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors">
            <Icon name="XMarkIcon" size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* Config selectors */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Company', value: 'PT Nusantara Teknologi', icon: 'BuildingOfficeIcon' },
              { label: 'Period', value: 'Jan–Aug 2026', icon: 'CalendarIcon' },
              { label: 'Branch', value: 'All Branches', icon: 'MapPinIcon' },
              { label: 'Currency', value: 'IDR', icon: 'CurrencyDollarIcon' },
            ].map((cfg) => (
              <div key={`cfg-${cfg.label}`} className="bg-secondary rounded-lg p-3">
                <p className="text-2xs font-600 text-muted-foreground uppercase tracking-wider mb-1">{cfg.label}</p>
                <div className="flex items-center gap-1.5">
                  <Icon name={cfg.icon as any} size={13} className="text-muted-foreground" />
                  <p className="text-xs font-500 text-foreground truncate">{cfg.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Custom Question */}
          <div className="mb-5">
            <label className="text-sm font-600 text-foreground block mb-1.5">Custom Question</label>
            <p className="text-xs text-muted-foreground mb-2">Ask any financial question in plain language</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={customQuestion}
                onChange={(e) => setCustomQuestion(e.target.value)}
                placeholder="e.g. What is causing our operating expenses to increase?"
                className="flex-1 text-sm border border-border rounded-md px-3 py-2 bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              <button
                onClick={() => { if (customQuestion) { setSelectedTemplate('profit-decrease'); handleStart(); } }}
                className="flex items-center gap-1.5 text-sm bg-ai-purple text-white font-500 rounded-md px-3 py-2 hover:bg-purple-700 transition-colors flex-shrink-0"
              >
                <Icon name="SparklesIcon" size={13} />
                Analyze
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground font-500">OR CHOOSE A TEMPLATE</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Templates */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {templates.map((t) => (
              <button
                key={`tmpl-${t.id}`}
                onClick={() => setSelectedTemplate(t.id)}
                className={`text-left p-4 rounded-lg border transition-all ${
                  selectedTemplate === t.id
                    ? 'border-ai-purple bg-ai-purple-bg' :'border-border hover:border-ai-purple/40 hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${selectedTemplate === t.id ? 'bg-ai-purple' : 'bg-secondary'}`}>
                    <Icon name={t.icon as any} size={15} className={selectedTemplate === t.id ? 'text-white' : 'text-muted-foreground'} />
                  </div>
                  <div className="min-w-0">
                    <p className={`text-sm font-600 ${selectedTemplate === t.id ? 'text-ai-purple' : 'text-foreground'}`}>{t.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t.desc}</p>
                    <p className="text-2xs text-muted-foreground mt-1 italic">{t.recommended}</p>
                  </div>
                  {selectedTemplate === t.id && (
                    <Icon name="CheckCircleIcon" size={16} className="text-ai-purple flex-shrink-0" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-border bg-secondary/30">
          <button onClick={onClose} className="text-sm font-500 text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!selectedTemplate || isStarting}
            className="flex items-center gap-2 bg-ai-purple text-white text-sm font-500 rounded-md px-5 py-2 hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isStarting ? (
              <>
                <Icon name="ArrowPathIcon" size={14} className="animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Icon name="SparklesIcon" size={14} />
                Start Analysis
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}