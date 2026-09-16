import React from 'react';
import KpiCard from '../../shared/TabKpiCard';
import { ShoppingCart, Clock, CheckCircle, AlertTriangle, Receipt } from 'lucide-react';

export default function PurchaseKpiRow() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
      <KpiCard
        label="Total Purchases (Sep)"
        value="$198,420"
        subValue="36 purchase invoices"
        trend={8.3}
        trendLabel="vs Aug 2026"
        icon={<ShoppingCart size={18} />}
        variant="info"
      />
      <KpiCard
        label="Outstanding AP"
        value="$54,180"
        subValue="11 invoices due"
        trend={-5.2}
        trendLabel="vs prior period"
        icon={<Clock size={18} />}
        variant="warning"
      />
      <KpiCard
        label="Approved Purchases"
        value="$144,240"
        subValue="28 invoices approved"
        trend={6.1}
        trendLabel="vs Aug 2026"
        icon={<CheckCircle size={18} />}
        variant="positive"
      />
      <KpiCard
        label="Pending Approval"
        value="$22,640"
        subValue="6 awaiting approval"
        trend={18.4}
        trendLabel="vs prior period"
        icon={<AlertTriangle size={18} />}
        variant="negative"
      />
      <KpiCard
        label="Input Tax (GST/VAT)"
        value="$16,640"
        subValue="8.38% effective rate"
        trend={7.9}
        trendLabel="vs Aug 2026"
        icon={<Receipt size={18} />}
        variant="default"
      />
    </div>
  );
}