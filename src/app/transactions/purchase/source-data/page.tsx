'use client';

import React from 'react';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import PurchaseSourceData from '@/app/transactions/purchase/components/PurchaseSourceData';

// Tampilan disamakan dengan Sales > Source Data (lihat PurchaseSourceData.tsx).
// Versi lama halaman ini (tabel source record + filter + detail panel) sudah
// diganti. Data berasal dari backend (file yang diupload lewat tab ini).
export default function PurchaseSourceDataPage() {
  return (
    <div className="space-y-0">
      <PurchaseTabs showDateRange />
      {/* PurchaseTabs sudah punya mb-4; pt-1 menggenapi jarak jadi 20px (= pt-5 di Sales) */}
      <div className="pt-1">
        <PurchaseSourceData />
      </div>
    </div>
  );
}