import React from 'react';
import { recentActivity, JEStatus } from '@/data/journalEntryData';
import StatusBadge from '@/components/ui/StatusBadge';
import { CheckCircle2, AlertTriangle, FileEdit, Send, BookOpen, Clock } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';

const statusBadgeMap: Record<JEStatus, { label: string; variant: 'positive' | 'negative' | 'warning' | 'info' | 'ai' | 'neutral' }> = {
  draft: { label: 'Draft', variant: 'neutral' },
  pending: { label: 'Pending', variant: 'warning' },
  approved: { label: 'Approved', variant: 'info' },
  posted: { label: 'Posted', variant: 'positive' },
  rejected: { label: 'Rejected', variant: 'negative' },
  exception: { label: 'Exception', variant: 'negative' },
};


const actionIcons: Record<string, React.ElementType> = {
  'Created': FileEdit,
  'Approved': CheckCircle2,
  'Posted': BookOpen,
  'Exception Flagged': AlertTriangle,
  'Saved Draft': FileEdit,
  'Submitted for Review': Send,
};

const actionColors: Record<string, string> = {
  'Created': 'text-blue-600 bg-blue-50',
  'Approved': 'text-emerald-600 bg-emerald-50',
  'Posted': 'text-emerald-700 bg-emerald-50',
  'Exception Flagged': 'text-red-600 bg-red-50',
  'Saved Draft': 'text-slate-600 bg-slate-100',
  'Submitted for Review': 'text-amber-600 bg-amber-50',
};

export default function OverviewActivityFeed() {
  return (
    <div className="je-card">
      <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
        <div>
          <h2 className="text-sm font-700 text-foreground">Recent Activity</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Today · Sep 14, 2026</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock size={12} />
          <span>Last updated 20:52</span>
        </div>
      </div>
      <div className="divide-y divide-border">
        {recentActivity.map((item) => {
          const Icon = actionIcons[item.action] ?? FileEdit;
          const colorClass = actionColors[item.action] ?? 'text-slate-600 bg-slate-100';
          return (
            <div key={item.id} className="flex items-start gap-3 px-5 py-3 hover:bg-muted/40 transition-colors">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${colorClass}`}>
                <Icon size={13} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-700 text-foreground font-mono tracking-tight">{item.jeNumber}</span>
                  <StatusBadge label={statusBadgeMap[item.status].label} variant={statusBadgeMap[item.status].variant} size="sm" />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.description}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  <span className="font-500 text-foreground">{item.action}</span>
                  {' '}by {item.user}
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground flex-shrink-0 tabular-nums">{item.time}</span>
            </div>
          );
        })}
      </div>
      <div className="px-5 py-3 border-t border-border">
        <button className="text-xs text-primary font-600 hover:underline">View full activity log →</button>
      </div>
    </div>
  );
}