import React from 'react';
import KpiCard from '../shared/TabKpiCard';
import { DollarSign, Clock, CheckCircle, AlertTriangle, Receipt } from 'lucide-react';

export default function SalesKpiRow() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
      <KpiCard
        label="Total Sales (Sep)"
        value="$284,760"
        subValue="48 invoices this period"
        trend={12.4}
        trendLabel="vs Aug 2026"
        icon={<DollarSign size={18} />}
        variant="positive"
        className="xl:col-span-1"
      />
      <KpiCard
        label="Outstanding AR"
        value="$67,340"
        subValue="14 invoices pending"
        trend={-3.1}
        trendLabel="vs prior period"
        icon={<Clock size={18} />}
        variant="warning"
      />
      <KpiCard
        label="Paid Invoices"
        value="$198,920"
        subValue="32 invoices collected"
        trend={8.7}
        trendLabel="vs Aug 2026"
        icon={<CheckCircle size={18} />}
        variant="positive"
      />
      <KpiCard
        label="Overdue Amount"
        value="$18,500"
        subValue="5 invoices overdue"
        trend={-15.2}
        trendLabel="vs prior period"
        icon={<AlertTriangle size={18} />}
        variant="negative"
      />
      <KpiCard
        label="Sales Tax Collected"
        value="$23,840"
        subValue="8.37% effective rate"
        trend={11.2}
        trendLabel="vs Aug 2026"
        icon={<Receipt size={18} />}
        variant="info"
      />
    </div>
  );
}