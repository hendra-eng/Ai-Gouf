'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { SparklesIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/solid';
import Icon from '@/components/ui/AppIcon';


interface Insight {
  id: number;
  title: string;
  description: string;
  metric: string;
  severity: 'positive' | 'negative' | 'warning' | 'neutral';
}

interface AIInsightsPanelProps {
  title?: string;
  insights: Insight[];
  /** Dipanggil saat "Analyze" ditekan. Kalau tidak diisi, fallback navigasi ke halaman AI Financial Analyst. */
  onAnalyze?: (insight: Insight) => void;
}

const severityConfig = {
  positive: {
    icon: CheckCircleIcon,
    iconColor: 'text-emerald-500',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-700',
    label: 'Positive',
  },
  negative: {
    icon: ExclamationTriangleIcon,
    iconColor: 'text-red-500',
    bg: 'bg-red-50',
    border: 'border-red-200',
    badge: 'bg-red-100 text-red-700',
    label: 'Alert',
  },
  warning: {
    icon: ExclamationTriangleIcon,
    iconColor: 'text-amber-500',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    badge: 'bg-amber-100 text-amber-700',
    label: 'Warning',
  },
  neutral: {
    icon: InformationCircleIcon,
    iconColor: 'text-blue-500',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    badge: 'bg-blue-100 text-blue-700',
    label: 'Info',
  },
};

export default function AIInsightsPanel({ title = 'AI Insights', insights, onAnalyze }: AIInsightsPanelProps) {
  const router = useRouter();

  const handleAnalyze = (insight: Insight) => {
    if (onAnalyze) {
      onAnalyze(insight);
    } else {
      router.push(`/ai-financial-analyst?insight=${insight.id}`);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-500 to-indigo-600 flex items-center justify-center">
          <SparklesIcon className="w-4 h-4 text-white" />
        </div>
        <h3 className="font-semibold text-slate-800 text-sm">{title}</h3>
        <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">AI Generated</span>
      </div>
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {insights.map(insight => {
          const cfg = severityConfig[insight.severity];
          const Icon = cfg.icon;
          return (
            <div key={insight.id} className={`rounded-lg border p-3.5 ${cfg.bg} ${cfg.border}`}>
              <div className="flex items-start gap-2.5">
                <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cfg.iconColor}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-slate-800 text-sm font-semibold">{insight.title}</h4>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="text-slate-600 text-xs leading-relaxed mb-2">{insight.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-700 text-xs font-semibold bg-white/70 px-2 py-0.5 rounded-md border border-white/50">
                      {insight.metric}
                    </span>
                    <button
                      onClick={() => handleAnalyze(insight)}
                      className="flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700 transition-colors"
                    >
                      Analyze
                      <ArrowRightIcon className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
