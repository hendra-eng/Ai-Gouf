import React from 'react';
import KpiCard from '../shared/TabKpiCard';
import { DollarSign, Clock, CheckCircle, AlertTriangle, Receipt } from 'lucide-react';

export default function SalesKpiRow() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
      <KpiCard
        label="Total Sales (Sep)"
        value="$0"
        subValue="0 invoices this period"
        trend={0}
        trendLabel="vs Aug 2026"
        icon={<DollarSign size={18} />}
        variant="positive"
        className="xl:col-span-1"
      />
      <KpiCard
        label="Outstanding AR"
        value="$0"
        subValue="0 invoices pending"
        trend={0}
        trendLabel="vs prior period"
        icon={<Clock size={18} />}
        variant="warning"
      />
      <KpiCard
        label="Paid Invoices"
        value="$0"
        subValue="0 invoices collected"
        trend={0}
        trendLabel="vs Aug 2026"
        icon={<CheckCircle size={18} />}
        variant="positive"
      />
      <KpiCard
        label="Overdue Amount"
        value="$0"
        subValue="0 invoices overdue"
        trend={0}
        trendLabel="vs prior period"
        icon={<AlertTriangle size={18} />}
        variant="negative"
      />
      <KpiCard
        label="Sales Tax Collected"
        value="$0"
        subValue="0% effective rate"
        trend={0}
        trendLabel="vs Aug 2026"
        icon={<Receipt size={18} />}
        variant="info"
      />
    </div>
  );
}