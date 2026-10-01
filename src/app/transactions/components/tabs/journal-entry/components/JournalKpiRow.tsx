import React from 'react';
import KpiCard from '../../shared/TabKpiCard';
import { BookOpen, CheckCircle, Clock, AlertTriangle } from 'lucide-react';

export default function JournalKpiRow() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <KpiCard
        label="Total Entries (Sep)"
        value="0"
        subValue="Journal entries this period"
        trend={0}
        trendLabel="vs Aug 2026"
        icon={<BookOpen size={18} />}
        variant="default"
      />
      <KpiCard
        label="Posted"
        value="0"
        subValue="$0 total posted"
        trend={0}
        trendLabel="vs Aug 2026"
        icon={<CheckCircle size={18} />}
        variant="positive"
      />
      <KpiCard
        label="Pending Review"
        value="0"
        subValue="$0 awaiting review"
        trend={0}
        trendLabel="vs prior period"
        icon={<Clock size={18} />}
        variant="warning"
      />
      <KpiCard
        label="Unbalanced Entries"
        value="0"
        subValue="Require immediate correction"
        trend={0}
        trendLabel="vs prior period"
        icon={<AlertTriangle size={18} />}
        variant="negative"
      />
    </div>
  );
}