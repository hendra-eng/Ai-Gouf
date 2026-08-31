import React from 'react';
import Icon from '@/components/ui/AppIcon';

type Severity = 'info' | 'positive' | 'warning' | 'critical';

const severityConfig: Record<Severity, { bg: string; border: string; iconColor: string; icon: string; label: string }> = {
  info: { bg: 'bg-blue-50', border: 'border-blue-100', iconColor: 'text-blue-600', icon: 'InformationCircleIcon', label: 'Info' },
  positive: { bg: 'bg-positive-subtle', border: 'border-green-100', iconColor: 'text-positive', icon: 'CheckCircleIcon', label: 'Positive' },
  warning: { bg: 'bg-warning-subtle', border: 'border-amber-100', iconColor: 'text-warning', icon: 'ExclamationTriangleIcon', label: 'Warning' },
  critical: { bg: 'bg-negative-subtle', border: 'border-red-100', iconColor: 'text-negative', icon: 'XCircleIcon', label: 'Critical' },
};

interface FinancialInsightCardProps {
  title: string;
  description: string;
  metric: string;
  severity: Severity;
  onAnalyze?: () => void;
}

export default function FinancialInsightCard({ title, description, metric, severity, onAnalyze }: FinancialInsightCardProps) {
  const cfg = severityConfig[severity];
  return (
    <div className={`rounded-lg border p-4 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 shrink-0 ${cfg.iconColor}`}>
          <Icon name={cfg.icon as Parameters<typeof Icon>[0]['name']} size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[12px] font-600 text-foreground">{title}</span>
            <span className={`fin-badge text-[9px] px-1.5 py-0 border ${cfg.border} ${cfg.iconColor} bg-white/60`}>{cfg.label}</span>
          </div>
          <p className="text-[12px] text-muted-foreground mb-2">{description}</p>
          <div className="text-[11px] font-600 text-foreground">{metric}</div>
        </div>
        {onAnalyze && (
          <button
            onClick={onAnalyze}
            className="shrink-0 text-[11px] font-500 text-ai hover:text-accent transition-colors flex items-center gap-1"
          >
            <Icon name="SparklesIcon" size={12} />
            Analyze
          </button>
        )}
      </div>
    </div>
  );
}
