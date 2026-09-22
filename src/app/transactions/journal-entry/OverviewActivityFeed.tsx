'use client';

import React from 'react';
import StatusBadge from '@/components/ui/StatusBadge';
import { CheckCircle2, AlertTriangle, FileEdit, Send, BookOpen, Clock } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useJeActivityLogs } from '@/lib/journalEntryStore';

const statusBadgeMap: Record<string, { label: string; variant: 'positive' | 'negative' | 'warning' | 'info' | 'ai' | 'neutral' }> = {
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

function formatJam(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '-';
  }
}

export default function OverviewActivityFeed() {
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { logs, loading } = useJeActivityLogs(clientId);
  const items = logs.slice(0, 8);
  const lastUpdated = items[0] ? formatJam(items[0].created_at) : '-';

  return (
    <div className="je-card">
      <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
        <div>
          <h2 className="text-sm font-700 text-foreground">Recent Activity</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{items.length} recent activities</p>
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock size={12} />
            <span>Last updated {lastUpdated}</span>
          </div>
        )}
      </div>
      <div className="divide-y divide-border">
        {loading ? (
          <div className="px-5 py-6 text-xs text-muted-foreground">Loading activity…</div>
        ) : items.length === 0 ? (
          <div className="px-5 py-6 text-xs text-muted-foreground">No journal entry activity yet.</div>
        ) : items.map((item) => {
          const Icon = actionIcons[item.event_type] ?? FileEdit;
          const colorClass = actionColors[item.event_type] ?? 'text-slate-600 bg-slate-100';
          const badge = statusBadgeMap[item.status_snapshot ?? ''] ?? { label: item.status_snapshot ?? '-', variant: 'neutral' as const };
          return (
            <div key={item.id} className="flex items-start gap-3 px-5 py-3 hover:bg-muted/40 transition-colors">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${colorClass}`}>
                <Icon size={13} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-700 text-foreground font-mono tracking-tight">{item.je_number ?? '-'}</span>
                  <StatusBadge label={badge.label} variant={badge.variant} size="sm" />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.description}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  <span className="font-500 text-foreground">{item.event_type}</span>
                  {' '}by {item.performed_by}
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground flex-shrink-0 tabular-nums">{formatJam(item.created_at)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
