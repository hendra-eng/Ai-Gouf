'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, TrendingUp, AlertTriangle, CheckCircle, ArrowRight, ChevronRight } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';
import { useLanguage } from '@/lib/language';
import EmptyState from '@/components/ui/EmptyState';


// Backend integration point: replace with /api/ai/insights?company=&period=
// [UBAH] Data contoh dikosongkan -- hanya tampil kalau backend AI insight
// sudah mengembalikan hasil nyata untuk client aktif.
const insights: {
  id: string;
  severity: 'warning' | 'negative' | 'positive' | 'info';
  icon: typeof AlertTriangle;
  title: string;
  body: string;
  metric: string;
  metricVariant: 'positive' | 'negative';
  action: string;
}[] = [];

const bgMap = {
  warning: 'bg-warning-subtle border-warning/30',
  negative: 'bg-negative-subtle border-negative/20',
  positive: 'bg-positive-subtle border-positive/20',
  info: 'bg-info-subtle border-info/20',
};

const iconBgMap = {
  warning: 'bg-warning/10 text-warning',
  negative: 'bg-negative/10 text-negative',
  positive: 'bg-positive/10 text-positive',
  info: 'bg-info/10 text-info',
};

export default function AIInsightsPanel() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { fx } = useCurrency();
  const { t } = useLanguage();

  return (
    <div className="card-elevated-md rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-ai-subtle flex items-center justify-center">
            <Sparkles size={16} className="text-ai" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">{t('AI Financial Insights')}</h2>
          </div>
        </div>
        <span className="badge-ai">{insights.length} {t(insights.length > 1 ? 'insights' : 'insight')}</span>
      </div>

      {insights.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={t('No insights yet')}
          description={t('AI-generated insights will appear here once there is enough posted transaction data to analyze.')}
        />
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {insights.map((ins) => {
          const Icon = ins.icon;
          const isExpanded = expanded === ins.id;
          const title = t(ins.title);
          const action = t(ins.action);
          return (
            <div
              key={ins.id}
              className={`rounded-xl border p-4 transition-all duration-200 cursor-pointer hover:shadow-card-md ${bgMap[ins.severity]}`}
              onClick={() => setExpanded(isExpanded ? null : ins.id)}
            >
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBgMap[ins.severity]}`}>
                  <Icon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-tight">{title}</p>
                  <p className={`text-xs font-semibold mt-1 font-mono ${
                    ins.metricVariant === 'positive' ? 'text-positive' : 'text-negative'
                  }`}>
                    {fx(t(ins.metric))}
                  </p>
                </div>
                <ChevronRight
                  size={14}
                  className={`text-muted-foreground flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                />
              </div>

              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-border/50 fade-in">
                  <p className="text-xs text-muted-foreground leading-relaxed">{fx(t(ins.body))}</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); toast.info(action, { description: title }); }}
                    className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    {action}
                    <ArrowRight size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}