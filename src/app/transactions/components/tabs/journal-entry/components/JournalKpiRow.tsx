import React from 'react';
import KpiCard from '../../shared/TabKpiCard';
import { BookOpen, CheckCircle, Clock, AlertTriangle } from 'lucide-react';

export default function JournalKpiRow() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <KpiCard
        label="Total Entries (Sep)"
        value="62"
        subValue="Journal entries this period"
        trend={4.2}
        trendLabel="vs Aug 2026"
        icon={<BookOpen size={18} />}
        variant="default"
      />
      <KpiCard
        label="Posted"
        value="48"
        subValue="$1,284,600 total posted"
        trend={7.1}
        trendLabel="vs Aug 2026"
        icon={<CheckCircle size={18} />}
        variant="positive"
      />
      <KpiCard
        label="Pending Review"
        value="11"
        subValue="$186,240 awaiting review"
        trend={22.2}
        trendLabel="vs prior period"
        icon={<Clock size={18} />}
        variant="warning"
      />
      <KpiCard
        label="Unbalanced Entries"
        value="3"
        subValue="Require immediate correction"
        trend={-1}
        trendLabel="vs prior period"
        icon={<AlertTriangle size={18} />}
        variant="negative"
      />
    </div>
  );
}