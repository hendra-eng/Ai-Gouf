import React from 'react';
import KpiCard from '../../shared/TabKpiCard';
import { ShoppingCart, Clock, CheckCircle, AlertTriangle, Receipt } from 'lucide-react';

export default function PurchaseKpiRow() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
      <KpiCard
        label="Total Purchases (Sep)"
        value="$0"
        subValue="0 purchase invoices"
        trend={0}
        trendLabel="vs Aug 2026"
        icon={<ShoppingCart size={18} />}
        variant="info"
      />
      <KpiCard
        label="Outstanding AP"
        value="$0"
        subValue="0 invoices due"
        trend={0}
        trendLabel="vs prior period"
        icon={<Clock size={18} />}
        variant="warning"
      />
      <KpiCard
        label="Approved Purchases"
        value="$0"
        subValue="0 invoices approved"
        trend={0}
        trendLabel="vs Aug 2026"
        icon={<CheckCircle size={18} />}
        variant="positive"
      />
      <KpiCard
        label="Pending Approval"
        value="$0"
        subValue="0 awaiting approval"
        trend={0}
        trendLabel="vs prior period"
        icon={<AlertTriangle size={18} />}
        variant="negative"
      />
      <KpiCard
        label="Input Tax (GST/VAT)"
        value="$0"
        subValue="0% effective rate"
        trend={0}
        trendLabel="vs Aug 2026"
        icon={<Receipt size={18} />}
        variant="default"
      />
    </div>
  );
}